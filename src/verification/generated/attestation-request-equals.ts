//////////////////////////////////////////////////////////////
// This file is auto generated. Do not edit.
//////////////////////////////////////////////////////////////

import Web3 from "web3";
import { ARPayment, ARBalanceDecreasingTransaction, ARConfirmedBlockHeightExists, ARReferencedPaymentNonexistence, ARType } from "./attestation-request-types";
import { AttestationType } from "./attestation-types-enum";

const toBN = Web3.utils.toBN;
//////////////////////////////////////////////////////////////
// Functions for encoding attestation requests to byte strings
//////////////////////////////////////////////////////////////

export class AttestationRequestEqualsError extends Error {
  constructor(message: any) {
    super(message);
    this.name = "AttestationRequestEqualsError";
  }
}

export function assertEqualsByScheme(a: any, b: any, type: string) {
  switch (type) {
    case "AttestationType":
      return a === b;
    case "NumberLike":
      return toBN(a).eq(toBN(b));
    case "SourceId":
      return a === b;
    case "ByteSequenceLike":
      return a === b;
    default:
      throw new AttestationRequestEqualsError("Wrong type");
  }
}

/**
 * Checks whether @param request1 and @param request2 of type Payment are querying the same thing
 */
export function equalsPayment(request1: ARPayment, request2: ARPayment) {
  if (!assertEqualsByScheme(request1.attestationType, request2.attestationType, "AttestationType")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.sourceId, request2.sourceId, "SourceId")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.messageIntegrityCode, request2.messageIntegrityCode, "ByteSequenceLike")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.id, request2.id, "ByteSequenceLike")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.blockNumber, request2.blockNumber, "NumberLike")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.inUtxo, request2.inUtxo, "NumberLike")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.utxo, request2.utxo, "NumberLike")) {
    return false;
  }
  return true;
}

/**
 * Checks whether @param request1 and @param request2 of type BalanceDecreasingTransaction are querying the same thing
 */
export function equalsBalanceDecreasingTransaction(request1: ARBalanceDecreasingTransaction, request2: ARBalanceDecreasingTransaction) {
  if (!assertEqualsByScheme(request1.attestationType, request2.attestationType, "AttestationType")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.sourceId, request2.sourceId, "SourceId")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.messageIntegrityCode, request2.messageIntegrityCode, "ByteSequenceLike")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.id, request2.id, "ByteSequenceLike")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.blockNumber, request2.blockNumber, "NumberLike")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.inUtxo, request2.inUtxo, "NumberLike")) {
    return false;
  }
  return true;
}

/**
 * Checks whether @param request1 and @param request2 of type ConfirmedBlockHeightExists are querying the same thing
 */
export function equalsConfirmedBlockHeightExists(request1: ARConfirmedBlockHeightExists, request2: ARConfirmedBlockHeightExists) {
  if (!assertEqualsByScheme(request1.attestationType, request2.attestationType, "AttestationType")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.sourceId, request2.sourceId, "SourceId")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.messageIntegrityCode, request2.messageIntegrityCode, "ByteSequenceLike")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.blockNumber, request2.blockNumber, "NumberLike")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.queryWindow, request2.queryWindow, "NumberLike")) {
    return false;
  }
  return true;
}

/**
 * Checks whether @param request1 and @param request2 of type ReferencedPaymentNonexistence are querying the same thing
 */
export function equalsReferencedPaymentNonexistence(request1: ARReferencedPaymentNonexistence, request2: ARReferencedPaymentNonexistence) {
  if (!assertEqualsByScheme(request1.attestationType, request2.attestationType, "AttestationType")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.sourceId, request2.sourceId, "SourceId")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.messageIntegrityCode, request2.messageIntegrityCode, "ByteSequenceLike")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.minimalBlockNumber, request2.minimalBlockNumber, "NumberLike")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.deadlineBlockNumber, request2.deadlineBlockNumber, "NumberLike")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.deadlineTimestamp, request2.deadlineTimestamp, "NumberLike")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.destinationAddressHash, request2.destinationAddressHash, "ByteSequenceLike")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.amount, request2.amount, "NumberLike")) {
    return false;
  }
  if (!assertEqualsByScheme(request1.paymentReference, request2.paymentReference, "ByteSequenceLike")) {
    return false;
  }
  return true;
}

/**
 * Checks whether @param request1 and @param request2 are querying the same thing
 */
export function equalsRequest(request1: ARType, request2: ARType): boolean {
  if (request1.attestationType != request2.attestationType) {
    return false;
  }
  switch (request1.attestationType) {
    case AttestationType.Payment:
      return equalsPayment(request1 as ARPayment, request2 as ARPayment);
    case AttestationType.BalanceDecreasingTransaction:
      return equalsBalanceDecreasingTransaction(request1 as ARBalanceDecreasingTransaction, request2 as ARBalanceDecreasingTransaction);
    case AttestationType.ConfirmedBlockHeightExists:
      return equalsConfirmedBlockHeightExists(request1 as ARConfirmedBlockHeightExists, request2 as ARConfirmedBlockHeightExists);
    case AttestationType.ReferencedPaymentNonexistence:
      return equalsReferencedPaymentNonexistence(request1 as ARReferencedPaymentNonexistence, request2 as ARReferencedPaymentNonexistence);
    default:
      throw new AttestationRequestEqualsError("Invalid attestation type");
  }
}
