import { AttestationRequest, MIC_SALT, Verification, VerificationStatus } from "../../../../../verification/attestation-types/attestation-types";
import { dataHash } from "../../../../../verification/generated/attestation-hash-utils";
import { encodeRequest } from "../../../../../verification/generated/attestation-request-encode";
import { getAttestationTypeAndSource } from "../../../../../verification/generated/attestation-request-parse";
import { getAttestationTypeName } from "../../../../../verification/generated/attestation-types-enum";
import { getSourceName } from "../../../../../verification/sources/sources";
import { DHType } from "../../dtos/v-hash-types.dto";
import { ARType } from "../../dtos/v-request-types.dto";

export abstract class VerifierProcessor {
  public abstract verify(attestationRequest: AttestationRequest): Promise<Verification<ARType, DHType>>;
  public abstract supportedAttestationTypes(): string[];
  public abstract supportedSource(): string;

  /**
   * Verifies @param request. Used by attestation client.
   * @returns
   */
  public async prepareRequest(request: ARType): Promise<Verification<ARType, DHType>> {
    return this.verify({ request: encodeRequest(request) });
  }

  /**
   * Returns the message integrity code for the given attestation request.
   * If the attestation request is invalid, an error is thrown.
   * @param request
   * @returns
   */
  public async getMessageIntegrityCheck(request: ARType): Promise<string> {
    const data = await this.verify({ request: encodeRequest(request) });
    if (data.status !== VerificationStatus.OK) {
      throw new Error(`Invalid attestation request: ${data.status}`);
    }
    const integrity = dataHash(data.request, data.response, MIC_SALT);
    return integrity;
  }

  /**
   * Returns the byte encoded attestation request with the correct message integrity code.
   * @param request
   * @returns
   */
  public async getAttestationData(request: ARType): Promise<string> {
    const data = await this.verify({ request: encodeRequest(request) });
    if (data.status !== VerificationStatus.OK) {
      throw new Error(`Invalid attestation request: ${data.status}`);
    }
    const integrity = dataHash(data.request, data.response, MIC_SALT);
    request.messageIntegrityCode = integrity;
    return encodeRequest(request);
  }

  /**
   * Asserts that the attestation request is supported by the verifier.
   * @param attestationRequest
   * @returns
   */
  public assertIsSupported(attestationRequest: AttestationRequest) {
    if (process.env.NODE_ENV === "development" && process.env.TEST_IGNORE_SUPPORTED_ATTESTATION_CHECK_TEST) {
      return;
    }
    let { attestationType, sourceId } = getAttestationTypeAndSource(attestationRequest.request);
    if (this.supportedSource() !== getSourceName(sourceId)) {
      throw new Error(`Unsupported source '${getSourceName(sourceId)}'. Verifier supports '${this.supportedSource()}'`);
    }
    let attTypeName = getAttestationTypeName(attestationType);
    if (this.supportedAttestationTypes().indexOf(attTypeName) < 0) {
      throw new Error(
        `Unsupported attestation type '${attTypeName}'. Supported types for verifier '${this.supportedSource()}': ${this.supportedAttestationTypes().join(
          ", "
        )}`
      );
    }
  }
}
