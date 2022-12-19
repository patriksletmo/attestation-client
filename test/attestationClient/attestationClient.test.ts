// yarn test test/attestationClient/attestationClient.test.ts

import { traceManager } from "@flarenetwork/mcc";
import BN from "bn.js";
import { Attestation } from "../../lib/attester/Attestation";
import { AttestationData } from "../../lib/attester/AttestationData";
import { AttestationRoundManager } from "../../lib/attester/AttestationRoundManager";
import { AttesterClientConfiguration, AttesterCredentials } from "../../lib/attester/AttesterClientConfiguration";
import { AttesterWeb3 } from "../../lib/attester/AttesterWeb3";
import { ChainManager } from "../../lib/chain/ChainManager";
import { getGlobalLogger, initializeTestGlobalLogger } from "../../lib/utils/logger";
import { setRetryFailureCallback } from "../../lib/utils/PromiseTimeout";
import { TestLogger } from "../../lib/utils/testLogger";
import { SourceId } from "../../lib/verification/sources/sources";
import { TERMINATION_TOKEN } from "../test-utils/test-utils";

const chai = require("chai");
const expect = chai.expect;

class MockChainManager extends ChainManager {
  validateTransaction(sourceId: SourceId, transaction: Attestation) {}
}

class MockAttesterWeb3 extends AttesterWeb3 {
  constructor(credentials: AttesterCredentials) {
    super(credentials);
  }

  async initialize() {}

  check(bnString: string) {
    if (bnString.length != 64 + 2 || bnString[0] !== "0" || bnString[1] !== "x") {
      this.logger.error(`invalid BN formating ${bnString}`);
    }
  }

  async submitAttestation(
    action: string,
    bufferNumber: BN,
    // commit
    commitedMerkleRoot: string,
    commitedMaskedMerkleRoot: string,
    commitedRandom: string,
    // reveal
    revealedMerkleRoot: string,
    revealedRandom: string,

    verbose = true
  ) {
    const roundId = bufferNumber.toNumber() - 1;
    this.check(commitedMerkleRoot);
    this.check(commitedMaskedMerkleRoot);
    this.check(commitedRandom);
    this.check(revealedMerkleRoot);
    this.check(revealedRandom);
  }
}

describe.skip("Attestation Client", () => {
  let attestationRoundManager: AttestationRoundManager;

  before(async function () {
    initializeTestGlobalLogger();

    setRetryFailureCallback((label: string) => {
      throw new Error(TERMINATION_TOKEN);
    });

    traceManager.displayStateOnException = false;
  });

  beforeEach(async function () {
    TestLogger.clear();

    const logger = getGlobalLogger();

    // Reading configuration
    const config = new AttesterClientConfiguration();
    const credentials = new AttesterCredentials();

    const chainManager = new MockChainManager(this.logger);
    const attesterWeb3 = new MockAttesterWeb3(this.credentials);
    attestationRoundManager = new AttestationRoundManager(chainManager, config, credentials, logger, attesterWeb3);
  });

  ////////////////////////////////
  // Unit tests
  ////////////////////////////////
  it(`Create attestation sourceId and type from event`, async function () {
    const mockEvent = {
      blockNumber: 1,
      logIndex: 2,
      returnValues: {
        timestamp: 3,
        data: "0x5d0d557df9c7e2d70ac3ebe35117c25bb1ffa8873fac714dec6c4e362da8f3b6",
      },
    };

    const attestation = new AttestationData(mockEvent);

    expect(attestation.sourceId, "attestation.sourceId should be 1434319303").to.eq(1434319303);
    expect(attestation.type, "attestation.type should be 23821").to.eq(23821);
  });

  ////////////////////////////////
  // Integration tests
  ////////////////////////////////
  it(`Attestate Valid Request`, async function () {
    const mockEvent = {
      blockNumber: 10,
      logIndex: 1,
      returnValues: {
        timestamp: 123,
        data: "0x5d0d557df9c7e2d70ac3ebe35117c25bb1ffa8873fac714dec6c4e362da8f3b6",
      },
    };

    const attestation = new AttestationData(mockEvent);

    await attestationRoundManager.attestate(attestation);

    expect(TestLogger.exists("waiting on block 70015100 to be valid"), "block should be valid at start").to.eq(false);
  });
});