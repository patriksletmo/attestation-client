import { Managed, toBN } from "@flarenetwork/mcc";
import assert from "assert";
import { stringify } from "safe-stable-stringify";
import { BitmaskAccumulator } from "../choose-subsets-lib/BitmaskAccumulator";
import { chooseCandidate, countOnes, prefix0x, unPrefix0x } from "../choose-subsets-lib/subsets-lib";
import { DBAttestationRequest } from "../entity/attester/dbAttestationRequest";
import { DBVotingRoundResult } from "../entity/attester/dbVotingRoundResult";
import { criticalAsync } from "../indexer/indexer-utils";
import { SourceLimiter } from "../source/SourceLimiter";
import { SourceRouter } from "../source/SourceRouter";
import { EpochSettings } from "../utils/EpochSettings";
import { getTimeMilli } from "../utils/internetTime";
import { AttLogger, logException } from "../utils/logger";
import { commitHash, MerkleTree } from "../utils/MerkleTree";
import { retry } from "../utils/PromiseTimeout";
import { getCryptoSafeRandom, prepareString } from "../utils/utils";
import { hexlifyBN, toHex } from "../verification/attestation-types/attestation-types-helpers";
import { Attestation, AttestationStatus } from "./Attestation";
import { AttestationClientConfig } from "./AttestationClientConfig";
import { AttestationData } from "./AttestationData";
import { AttesterState } from "./AttesterState";
import { BitVoteData } from "./BitVoteData";
import { FlareConnection } from "./FlareConnection";
import { GlobalAttestationConfig } from "./GlobalAttestationConfig";

export enum AttestationRoundPhase {
  collect,
  choose,
  commit,
  reveal,
  completed,
}

// !!! STATUS ORDER IS IMPORTANT. It is crucial that the round can progress only to later status
// and not back
export enum AttestationRoundStatus {
  collecting,         // initial status
  bitVotingClosed,    // votes can be calculated
  chosen,             // bit vote result calculated and available
  commitDataPrepared, // commit data prepared

  committed,          // the round was successfully committed and receipt received
  revealed,           // the round was successfully revealed and receipt received

  error,
  processingTimeout,
}


const NO_VOTE = "0x00"
// terminology
// att/sec
// call/sec
// call/att

/**
 * Manages a specific attestation round, specifically the data in the commit-reveal scheme.
 */
@Managed()
export class AttestationRound {
  phase: AttestationRoundPhase = AttestationRoundPhase.collect;
  attestStatus: AttestationRoundStatus;
  roundId: number;

  logger: AttLogger;
  flareConnection: FlareConnection;

  attesterState: AttesterState;

  sourceRouter: SourceRouter;

  sourceLimiters = new Map<number, SourceLimiter>();
  activeGlobalConfig: GlobalAttestationConfig;
  attestationClientConfig: AttestationClientConfig;
  submitCommitFinalize: boolean;
  
  epochSettings: EpochSettings;

  nextRound!: AttestationRound;
  prevRound!: AttestationRound;

  // processing
  attestations = new Array<Attestation>();
  attestationsMap = new Map<string, Attestation>();
  attestationsProcessed = 0;

  // save submitted values for reveal
  roundMerkleRoot!: string;
  roundRandom!: string;
  roundMaskedMerkleRoot: string;

  merkleTree!: MerkleTree;

  duplicateCount: number = 0;
  _initialized = false;

  // default set voter addresses (lowercase)
  defaultSetAddresses: string[];
  // default set bit votes map
  bitVoteMap = new Map<string, string>();
  // a record of my bit vote
  bitVoteRecord?: string;
  // a result of bit voting
  bitVoteResultIndices?: number[] = [];

  constructor(
    epochId: number,
    activeGlobalConfig: GlobalAttestationConfig,
    epochSettings: EpochSettings,
    logger: AttLogger,
    flareConnection: FlareConnection,
    attesterState: AttesterState,
    sourceRouter: SourceRouter,
    attestationClientConfig: AttestationClientConfig
  ) {
    this.roundId = epochId;
    this.phase = AttestationRoundPhase.collect;
    this.attestStatus = AttestationRoundStatus.collecting;
    this.activeGlobalConfig = activeGlobalConfig;
    this.logger = logger;
    this.flareConnection = flareConnection;
    this.attesterState = attesterState;
    this.epochSettings = epochSettings;
    this.sourceRouter = sourceRouter;
    this.attestationClientConfig = attestationClientConfig;
  }

  get label() {
    let _label = ""
    if (this.attestationClientConfig.label != "none") {
      _label = `[${this.attestationClientConfig.label}]`;
    }
    return `#${_label} ${this.roundId}:${this.nowRelative}/${this.durationSec} `;
  }

  get durationSec() {
    return this.flareConnection.roundDurationSec;
  }

  get chooseWindowDurationMs() {
    return this.flareConnection.chooseDeadlineSec * 1000;
  }

  get windowDurationMs() {
    return this.flareConnection.roundDurationSec * 1000;
  }
  
  get forceCloseBitVotingOffsetMs() {
    return this.attestationClientConfig.forceCloseBitVotingSec * 1000;
  }
  get roundStartTimeMs() {
    return this.epochSettings.getRoundIdTimeStartMs(this.roundId);
  }

  get roundChooseStartTimeMs() {
    return this.roundStartTimeMs + this.windowDurationMs;
  }

  get roundForceCloseBitVotingTimeMs() {
    return this.roundChooseStartTimeMs + this.chooseWindowDurationMs + this.forceCloseBitVotingOffsetMs;
  }

  get roundCommitStartTimeMs() {
    return this.roundChooseStartTimeMs + this.chooseWindowDurationMs;
  }

  get roundRevealStartTimeMs() {
    return this.roundChooseStartTimeMs + this.windowDurationMs;
  }

  get commitEndTimeMs() {
    return this.roundRevealStartTimeMs + this.attestationClientConfig.commitTimeSec * 1000;
  }
  
  get roundCompleteTimeMs() {
    return this.roundRevealStartTimeMs + this.windowDurationMs;
  }


  /**
   * Returns bitmask accumulator based on validity of attestations.
   */
  get bitVoteAccumulator(): BitmaskAccumulator {
    let bitmask = new BitmaskAccumulator(this.attestations.length);
    for (let attestation of this.attestations) {
      bitmask.addBit(attestation.status === AttestationStatus.valid);
    }
    return bitmask;
  }

  get nowRelative() {
    let diff = Date.now() - this.epochSettings.getRoundIdTimeStartMs(this.roundId);
    return (diff / 1000).toFixed(1);
  }

  /**
   * Returns a hex bit mask of successfully validated transactions, prefixed 
   * with last byte of the round id (roundCheck).
   * Used to vote on BitVote contract, if the provider is in the default set.
   */
  get bitVoteMaskWithRoundCheck(): string {
    if (!this.bitVoteRecord) {
      throw new Error("Bit vote not yet recorded");
    }
    let roundHex = toHex(this.roundId, 1).slice(-2);
    return prefix0x(roundHex + unPrefix0x(this.bitVoteRecord));
  }

  /**
   * Closes bit voting.
   */
  public async closeBitVoting() {
    this.logger.info(`${this.label} - closeBitVoting - call`);
    if (this.attestStatus < AttestationRoundStatus.bitVotingClosed) {
      this.logger.info(`${this.label} - closeBitVoting - closed`);
      this.attestStatus = AttestationRoundStatus.bitVotingClosed;
      this.tryCalculateBitVotingResults();
      await this.tryPrepareCommitData();
    }
  }

  /**
   * Returns the number of currently validated attestations
   */
  get numberOfValidatedAttestations(): number {
    let count = 0;
    for (let attestation of this.attestations) {
      if (attestation.status === AttestationStatus.valid) {
        count++;
      }
    }
    return count;
  }

  /**
   * Calculates the bit voting result for the round.
   * The result is valid if we are sure that all votes are registered.
   */
  private bitVotingResult(verbose = true): BitmaskAccumulator | undefined {
    let votes = [];
    for (let address of this.defaultSetAddresses) {
      votes.push(this.bitVoteMap.get(address) ?? NO_VOTE);
    }

    if (verbose) {
      this.logger.info(`${this.label}Bit voting results`);
      for (let address of this.defaultSetAddresses) {
        let bitString = BitmaskAccumulator.fromHex(this.bitVoteMap.get(address) ?? NO_VOTE).toBitString();
        this.logger.info(`${this.label}${address.slice(0, 10)} - ${bitString}`);
      }
    }

    // Start with consensus subset size. If no votes are in intersection
    let bitmask: BitmaskAccumulator | undefined = undefined;
    let minVoters = Math.ceil(this.activeGlobalConfig.defaultSetAssignerAddresses.length / 2);

    // check if majority of voters did not vote (empty result)
    let nonZeroVotes = votes.filter((vote) => vote.replaceAll("0", "") !== "x").length;
    if (nonZeroVotes < minVoters) {
      this.logger.info(`${this.label} Less then minimal number of voters voted ${nonZeroVotes}, required >= ${minVoters}`);
      return new BitmaskAccumulator(this.attestations.length);
    }

    let foundNonzeroVote = false;
    // find first nonzero vote on subsets of sizes consensusSubsetSize, ..., minVoters
    for (let size = this.activeGlobalConfig.consensusSubsetSize; size >= minVoters; size--) {
      let candidate = chooseCandidate(votes, size);
      let numberOfOnes = countOnes(candidate);
      if (numberOfOnes > 0) {
        foundNonzeroVote = true;
        bitmask = BitmaskAccumulator.fromHex(candidate);
        if (size != this.activeGlobalConfig.consensusSubsetSize) {
          this.logger.info(`${this.label} - vote successful with lower consensus threshold ${size}/${this.activeGlobalConfig.consensusSubsetSize}`);
        }
        break;
      }
      this.logger.info(`${this.label} - unsuccessful vote count for threshold ${size}/${this.defaultSetAddresses.length}`);
    }

    if (!foundNonzeroVote) {
      this.logger.info(`${this.label} Non-conclusive vote. Non zero voters: ${nonZeroVotes}, required >= ${minVoters}`);
      return new BitmaskAccumulator(this.attestations.length);
    }

    if (bitmask.hasActiveBitsBeyond(this.attestations.length)) {
      this.logger.error(`${this.label}Local and all indices do not match. Critical error!`);
      return undefined;
    }

    if (verbose) {
      this.logger.info(`${this.label}-RESULT[${this.activeGlobalConfig.consensusSubsetSize}] - ${bitmask?.toBitString()}`);
    }
    return bitmask;
  }

  /**
   * Records bit vote result. May be called several times (retry)
   * @param verbose - whether verbose logging is used
   */
  private tryCalculateBitVotingResults(verbose = true) {
    this.logger.info(`${this.label} - tryCalculateBitVotingResults - call`);
    if (this.attestStatus >= AttestationRoundStatus.chosen) {
      this.logger.error(`${this.label} - tryCalculateBitVotingResults - chosen`);
      return;
    }

    // vote count can be done only in commit phase when the voting is closed
    if (this.phase !== AttestationRoundPhase.commit) {
      this.logger.error(`${this.label} - tryCalculateBitVotingResults - wrong phase '${AttestationRoundPhase[this.phase]}'`);
      return;
    }
    if (this.attestStatus !== AttestationRoundStatus.bitVotingClosed) {
      this.logger.error(`${this.label} - tryCalculateBitVotingResults - voting closed`);
      return;
    }

    const votingResult = this.bitVotingResult();
    const votingResultIndices = votingResult ? votingResult.toIndices(this.attestations.length) : [];
    let countRequired = 0;
    let isError = false;
    for (let i of votingResultIndices) {
      if (!this.attestations[i]) {
        this.logger.error(
          `${this.label}Bit vote indices do not match the number of attestations in round ${this.roundId}: index ${i}, attestations length ${this.attestations.length}.`
        );
        isError = true;
        break;
      }
      let status = this.attestations[i].status;
      if (status === AttestationStatus.valid) {
        countRequired++;
        this.attestations[i].chosen = true;
      } else if (status !== AttestationStatus.queued && status != AttestationStatus.processing) {
        this.logger.info(`${this.label}Unable to provide at least one required attestation.`);
        isError = true;
        break;
      }
    }
    if (isError) {
      this.bitVoteResultIndices = [];
    } else {
      if (countRequired != votingResultIndices.length) {
        this.logger.info(`${this.label} Choose phase voting not successful yet. Status ${countRequired}/${votingResultIndices.length}`);
        return;
      }
      this.bitVoteResultIndices = votingResultIndices;
      this.logger.info(`${this.label} Choose phase voting result successful. Status ${countRequired}/${votingResultIndices.length}`);
    }
    this.attestStatus = AttestationRoundStatus.chosen;

    // eslint-disable-next-line
    criticalAsync("saveRoundBitVoteResult", async () => {
      return await this.attesterState.saveRoundBitVoteResult(this.roundId, votingResult.toHex());
    });
  }

  /**
   * Returns the existing source Handler for the source chain of an attestation or creates a new sourceLimiter
   * @param data 
   * @param onValidateAttestation 
   * @returns 
   */
  getSourceLimiter(data: AttestationData): SourceLimiter {
    let sourceLimiter = this.sourceLimiters.get(data.sourceId);

    if (sourceLimiter) {
      return sourceLimiter;
    }
    const config = this.activeGlobalConfig.sourceLimiters.get(data.sourceId);
    sourceLimiter = new SourceLimiter(config, this.logger);

    this.sourceLimiters.set(data.sourceId, sourceLimiter);
    return sourceLimiter;
  }

  /**
   * Adds the @param attestation to the list of attestations for this round and starts the validation process
   */
  addAttestation(attestation: Attestation) {
    // remove duplicates (instruction hash, id, data av proof, ignore timestamp) on the fly
    // todo: check how fast is hash
    const requestId = attestation.data.getId();
    const duplicate = this.attestationsMap.get(requestId);

    if (duplicate) {
      this.logger.debug3(
        `${this.label}attestation ${duplicate.data.blockNumber}.${duplicate.data.logIndex} duplicate found ${attestation.data.blockNumber}.${attestation.data.logIndex}`
      );
      this.duplicateCount++;
      // duplicates are discarded
      return;
    }

    this.attestations.push(attestation);
    attestation.setIndex(this.attestations.length - 1);
    this.attestationsMap.set(requestId, attestation);

    // check if attestation is invalid
    if (attestation.status === AttestationStatus.failed) {
      this.processed(attestation);
      return;
    }

    // start attestation process
    if (this.getSourceLimiter(attestation.data).canProceedWithValidation(attestation)) {
      this.sourceRouter.validateAttestationRequest(attestation);
    } else {
      this.processed(attestation);
    }
  }

  /**
   * Registers bit vote event. If the vote is from one of the default attestors, the vote is 
   * registered.
   * We assume that the timestamp of the event matches the round id and events round Id check is 
   * also matching.
   * @param bitVoteData Bit vote event data 
   */
  registerBitVote(bitVoteData: BitVoteData) {
    let address = bitVoteData.sender.toLocaleLowerCase();
    if (this.defaultSetAddresses.indexOf(address) >= 0) {
      this.bitVoteMap.set(address, bitVoteData.bitVote);
    }
  }

  async initialize() {
    if (this._initialized) {
      return;
    }
    this.defaultSetAddresses = await retry(
      `${this.label}AttestationRound ${this.roundId} init default set`,
      async () => this.flareConnection.getAttestorsForAssignors(this.activeGlobalConfig.defaultSetAssignerAddresses)
    );

    this.defaultSetAddresses = this.defaultSetAddresses.map((address) => address.toLowerCase());

    // this.logger.debug(`${this.label}Round ${this.roundId} initialized with attestation providers`);
    // for(let [index, address] of this.defaultSetAddresses.entries()) {
    //   this.logger.debug(`[${index}] ${address}`);
    // }
    this._initialized = true;
  }
  /**
   * Announces the start of the choose phase
   */
  async startChoosePhase() {
    this.logger.group(
      `${this.label} choose phase started [1] ${this.attestationsProcessed}/${this.attestations.length} (${
        (this.attestations.length * 1000) / this.epochSettings.getEpochLengthMs().toNumber()
      } req/sec)`
    );
    this.phase = AttestationRoundPhase.choose;
  }

  /**
   * Announces the start of the commit phase and tries to commit
   */
  async startCommitPhase() {
    this.logger.group(
      `${this.label} commit epoch started [1] ${this.attestationsProcessed}/${this.attestations.length} (${
        (this.attestations.length * 1000) / this.epochSettings.getEpochLengthMs().toNumber()
      } req/sec)`
    );
    this.phase = AttestationRoundPhase.commit;
    await this.tryPrepareCommitData(); // In case all requests are already processed
  }

  /**
   * Empty commit.
   * Used in the first round after joining the attestation scheme to commit empty data for commit and reveal of two previous rounds???
   */
  startCommitSubmit() {
    if (this.attestationClientConfig.submitCommitFinalize) {
      const action = `Finalizing ^Y#${this.roundId - 3}^^`;

      // eslint-disable-next-line
      criticalAsync("startCommitSubmit", async () => {
        const receipt = await this.flareConnection.submitAttestation(
          action,
          // commit index (collect+1)
          toBN(this.roundId + 1),
          toHex(0, 32),
          toHex(0, 32),
          toHex(0, 32),
          toHex(0, 32),
          toHex(0, 32)
        );
        if (receipt) {
          this.logger.info(`${this.label}^G^wfinalized^^ round ^Y#${this.roundId - 3}`);
        }
      });
    }
  }

  /**
   * Announces the start of the reveal phase and sets the Round status to reveal
   */
  startRevealPhase() {
    this.logger.group(`${this.label} - reveal epoch started [2]`);
    this.phase = AttestationRoundPhase.reveal;
  }

  /**
   * Announces the the end of the round and sets the round status to completed
   */
  completed() {
    this.logger.group(`${this.label} - round completed`);
    this.phase = AttestationRoundPhase.completed;
  }

  processed(tx: Attestation): void {
    this.attestationsProcessed++;
    assert(this.attestationsProcessed <= this.attestations.length);

    // eslint-disable-next-line
    criticalAsync("processed", async () => {
      this.tryCalculateBitVotingResults();
      await this.tryPrepareCommitData();
    });
  }

  // async commitLimit(): Promise<void> {    
  //   if (this.attestStatus === AttestationRoundStatus.collecting) {
  //     this.logger.error2(`${this.label}Round #${this.roundId} processing timeout (${this.attestationsProcessed}/${this.attestations.length} attestation(s))`);

  //     // cancel all attestations
  //     this.attestStatus = AttestationRoundStatus.processingTimeout;
  //   }
  // }

  /**
   * Checks if commit data is ready.
   * @returns
   */
  canCommit(): boolean {
    this.logger.debug(
      `${this.label}canCommit(^Y#${this.roundId}^^) processed: ${this.attestationsProcessed}, all: ${this.attestations.length}, epoch phase: '${
        AttestationRoundPhase[this.phase]
      }', attest status '${AttestationRoundStatus[this.attestStatus]}'`
    );
    return (
      this.phase === AttestationRoundPhase.commit &&
      this.attestStatus === AttestationRoundStatus.commitDataPrepared
    );
  }

  /**
   * Formats an attestation to be stored in database
   * @param att
   * @returns
   */
  prepareDBAttestationRequest(att: Attestation): DBAttestationRequest {
    const db = new DBAttestationRequest();

    db.roundId = att.roundId;
    db.blockNumber = prepareString(att.data.blockNumber.toString(), 128);
    db.logIndex = att.data.logIndex;

    db.verificationStatus = prepareString(att.verificationData?.status.toString(), 128);
    db.attestationStatus = AttestationStatus[att.status];

    db.request = prepareString(stringify(att.verificationData?.request ? att.verificationData.request : ""), 4 * 1024);
    db.response = prepareString(stringify(att.verificationData?.response ? att.verificationData.response : ""), 4 * 1024);

    db.exceptionError = prepareString(att.exception?.toString(), 128);

    db.hashData = prepareString(att.verificationData?.hash, 256);

    db.requestBytes = prepareString(att.data.request, 4 * 1024);

    return db;
  }

  /**
   * Executes calculation of commit data from the commit-reveal scheme and saves the attestation data to database.
   * This function may be called several times, sometimes too early and retried later. Retrials are handled from outside.
   */
  async tryPrepareCommitData() {
    this.logger.info(`${this.label} - tryPrepareCommitData - call`);
    if (this.attestStatus >= AttestationRoundStatus.commitDataPrepared) {
      this.logger.info(`${this.label} - tryCalculateBitVotingResults - commit already prepared`);
      return;
    }

    // check if commit can be performed
    if (this.phase !== AttestationRoundPhase.commit) {
      this.logger.info(`${this.label} - tryPrepareCommitData - not commit phase: '${AttestationRoundPhase[this.phase]}'`);
      return;
    }

    if (this.attestStatus !== AttestationRoundStatus.chosen) {
      this.logger.info(`${this.label} - tryPrepareCommitData - not status 'chosen' ('${AttestationRoundStatus[this.attestStatus]}' instead)`);
      // this.logger.error(`${this.label}round #${this.roundId} cannot commit yet, bit voting result is not yet calculated.`);
      return;
    }

    // collect valid attestations and prepare to save all requests
    const dbAttestationRequests = [];
    const validated: Attestation[] = [];

    //  check if all attestations required by bit vote result are validated
    for (let i of this.bitVoteResultIndices) {
      const attestation = this.attestations[i];
      if (attestation.status === AttestationStatus.valid) {
        validated.push(attestation);
      }
    }

    // check if one can commit
    if (validated.length != this.bitVoteResultIndices.length) {
      this.logger.error(
        `${this.label}round #${this.roundId} cannot yet commit ${validated.length}/${this.bitVoteResultIndices.length} attestations validated.`
      );
      return;
    }

    // Prepare database entities for result logs
    for (let attestation of validated) {
      dbAttestationRequests.push(this.prepareDBAttestationRequest(attestation));
    }

    // save to DB only if epoch does not exists in the DB yet - save async
    const alreadySavedRound = await this.attesterState.entityManager.findOne(DBAttestationRequest, { where: { roundId: this.roundId } });

    if (!alreadySavedRound) {
      // eslint-disable-next-line
      criticalAsync("commit", async () => {
        await this.attesterState.entityManager.save(dbAttestationRequests);
      });
    }

    if (validated.length === 0) {
      this.logger.error(`${this.label}round #${this.roundId} nothing to commit - no valid attestation (${this.attestations.length} attestation(s))`);
      this.attestStatus = AttestationRoundStatus.commitDataPrepared;
      await this.createEmptyState();
      return;
    }

    this.logger.info(`${this.label}round #${this.roundId} committing (${validated.length}/${this.attestations.length} attestation(s))`);

    const time0 = getTimeMilli();

    // collect sorted valid attestation hashes
    const validatedHashes: string[] = new Array<string>();
    const dbVoteResults = [];
    for (const valid of validated) {
      const voteHash = valid.verificationData.hash!;
      validatedHashes.push(voteHash);

      // save to DB
      const dbVoteResult = new DBVotingRoundResult();
      dbVoteResults.push(dbVoteResult);

      dbVoteResult.roundId = this.roundId;
      dbVoteResult.hash = voteHash;
      dbVoteResult.request = stringify(valid.verificationData?.request ? hexlifyBN(valid.verificationData.request) : "");
      dbVoteResult.response = stringify(valid.verificationData?.response ? hexlifyBN(valid.verificationData.response) : "");
    }

    // save to DB
    try {
      await this.attesterState.entityManager.save(dbVoteResults);
    } catch (error) {
      logException(error, `${this.label}AttestationRound::commit save DB`);
    }

    const time1 = getTimeMilli();

    // create merkle tree
    this.merkleTree = new MerkleTree(validatedHashes);

    this.roundMerkleRoot = this.merkleTree.root!;
    this.roundRandom = await getCryptoSafeRandom();
    this.roundMaskedMerkleRoot = commitHash(this.roundMerkleRoot, this.roundRandom, this.flareConnection.web3Functions.account.address);

    // mark data is prepared
    this.attestStatus = AttestationRoundStatus.commitDataPrepared;

    // after commit state has been calculated add it in state
    await this.attesterState.saveRound(this, validated.length);

    const time2 = getTimeMilli();

    //
    //   collect   | commit       | reveal
    //   x         | x+1          | x+2
    //

    // calculate remaining time in epoch
    const now = getTimeMilli();
    const epochCommitEndTime = this.epochSettings.getRoundIdRevealTimeStartMs(this.roundId);
    const commitTimeLeft = epochCommitEndTime - now;

    this.logger.info(
      `${this.label}^w^Gcommit^^ round #${this.roundId} attestations: ${validatedHashes.length} time left ${commitTimeLeft}ms (prepare time H:${
        time1 - time0
      }ms M:${time2 - time1}ms)`
    );
  }

  async createEmptyState() {
    this.logger.debug2(`${this.label}create empty state for #${this.roundId}`);

    this.roundMerkleRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";
    this.roundRandom = await getCryptoSafeRandom();

    this.roundMaskedMerkleRoot = commitHash(this.roundMerkleRoot, this.roundRandom, this.flareConnection.web3Functions.account.address);

    // after commit state has been calculated add it in state
    await this.attesterState.saveRound(this);
  }

  /**
   * First nonempty commit after the attestation client starts running. Tries to get reveal data from database otherwise
   * it does not send reveal data for the previous round?
   */
  async firstCommit() {
    if (!this.canCommit()) {
      await this.createEmptyState();
    }

    const action = `${this.label}Submitting ^Y#${this.roundId}^^ for bufferNumber ${this.roundId + 1} (first commit)`;

    const prevRound = await this.attesterState.getRound(this.roundId - 1);

    // eslint-disable-next-line
    criticalAsync("firstCommit", async () => {
      const receipt = await this.flareConnection.submitAttestation(
        action,
        // commit index (collect+1)
        toBN(this.roundId + 1),
        // commit
        this.roundMerkleRoot,
        this.roundMaskedMerkleRoot,
        this.roundRandom,
        // reveal
        prevRound && prevRound.merkleRoot ? prevRound.merkleRoot : toHex(0, 32),
        prevRound && prevRound.random ? prevRound.random : toHex(0, 32)
      );

      // count the round as commited, event if receipt did not come back

      if (receipt) {
        this.attestStatus = AttestationRoundStatus.committed;
        this.logger.info(`${this.label}^G^wcomitted^^ round ^Y#${this.roundId}`);
      } else {
        this.attestStatus = AttestationRoundStatus.error;
      }
    });
  }

  /**
   * Sends reveal data for this round and commit data for next round
   */
  async reveal() {
    if (this.phase !== AttestationRoundPhase.reveal) {
      this.logger.error(`${this.label}round #${this.roundId} cannot reveal (not in reveal epoch status '${AttestationRoundPhase[this.phase]}')`);
      return;
    }

    // Log unexpected attestation round statuses, but proceed with submitAttestation

    let commitPrepared = this.attestStatus === AttestationRoundStatus.commitDataPrepared || this.attestStatus == AttestationRoundStatus.committed;

    if (!commitPrepared) {
      this.logger.error(
        `${this.label}round #${this.roundId} not committed. Status: '${AttestationRoundStatus[this.attestStatus]}'. Processed attestations: ${
          this.attestationsProcessed
        }/${this.attestations.length}`
      );
    }

    // this.logger.info(`^Cround #${this.roundId} reveal`);

    let nextRoundMerkleRoot = toHex(toBN(0), 32);
    let nextRoundMaskedMerkleRoot = toHex(toBN(0), 32);
    let nextRoundRandom = toHex(toBN(0), 32);

    const action = `${this.label}submitting ^Y#${this.roundId + 1}^^ revealing ^Y#${this.roundId}^^ bufferNumber ${this.roundId + 2}`;

    if (this.nextRound) {
      if (!this.nextRound.canCommit()) {
        await this.nextRound.createEmptyState();
      }

      nextRoundMerkleRoot = this.nextRound.roundMerkleRoot;
      nextRoundMaskedMerkleRoot = this.nextRound.roundMaskedMerkleRoot;
      nextRoundRandom = this.nextRound.roundRandom;
    }

    // eslint-disable-next-line
    criticalAsync("", async () => {
      const receipt = await this.flareConnection.submitAttestation(
        action,
        // commit index (collect+2)
        toBN(this.roundId + 2),
        // commit
        nextRoundMerkleRoot,
        nextRoundMaskedMerkleRoot,
        nextRoundRandom,
        // reveal
        commitPrepared ? this.roundMerkleRoot : toHex(0, 32),
        commitPrepared ? this.roundRandom : toHex(0, 32)
      );

      if (receipt) {
        this.logger.info(`${this.label}^Cround ^Y#${this.roundId}^C submit attestation completed (bufferNumber ${this.roundId + 2})`);
        if (this.nextRound) {
          this.nextRound.attestStatus = AttestationRoundStatus.committed;
        }
        this.attestStatus = AttestationRoundStatus.revealed;
      } else {
        this.logger.info(`${this.label}^Rround ^Y#${this.roundId}^R submit error (bufferNumber ${this.roundId + 2}) - no receipt`);
        if (this.nextRound) {
          // do not change the status
        }
        this.attestStatus = AttestationRoundStatus.error;
      }
    });
  }

  /**
   * Submits the bitmask for validated transaction.
   */
  async bitVote() {
    // To early. Retry later.
    if (this.phase === AttestationRoundPhase.collect) {
      setTimeout(() => this.bitVote(), 1000);
      return;
    }

    if (this.phase === AttestationRoundPhase.choose) {
      const action = `${this.label}bit voting for round ^Y#${this.roundId + 1}^^ bufferNumber ${this.roundId + 1}`;
      this.bitVoteRecord = this.bitVoteAccumulator.toHex(); // make a bitvote snapshot

      // eslint-disable-next-line      
      criticalAsync("Submit bit vote", async () => {
        const receipt = await this.flareConnection.submitBitVote(
          action,
          toBN(this.roundId + 1),
          this.bitVoteMaskWithRoundCheck, // snapshot
          this.attestations.length,
          this.numberOfValidatedAttestations,
          this.duplicateCount
        );
        if (receipt) {
          this.logger.info(`${this.label}^Cround ^Y#${this.roundId}^C bit vote submitted (buffernumber ${this.roundId + 1})`);
        } else {
          this.logger.error(`${this.label}^Rround ^Y#${this.roundId}^R bit vote submit error (buffernumber ${this.roundId + 1}) - no receipt`);
        }
      });
      return;
    }

    // Bit call called too late, wrong time
    this.logger.error(`${this.label}^Rround ^Y#${this.roundId}^R: bit vote at wrong time in phase ${AttestationRoundPhase[this.phase]}`);
  }
}