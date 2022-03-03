import { ChainType } from "flare-mcc";
import {
   AMOUNT_BYTES,
   AttestationTypeScheme, ATT_BYTES,
   BLOCKNUMBER_BYTES,
   CHAIN_ID_BYTES,
   DATA_AVAILABILITY_BYTES,
   PAYMENT_REFERENCE_BYTES,
   TIMESTAMP_BYTES
} from "./attestation-types";

export const TDEF: AttestationTypeScheme = {
   id: 4,
   supportedSources: [ChainType.XRP, ChainType.BTC, ChainType.LTC, ChainType.DOGE, ChainType.ALGO],
   name: "ReferencedPaymentNonexistence",
   request: [
      {
         key: "attestationType",
         size: ATT_BYTES,
         type: "AttestationType",
         description: 
`

`
      },
      {
         key: "chainId",
         size: CHAIN_ID_BYTES,
         type: "ChainType",
         description: 
`

`
      },
      {
         key: "endTimestamp",
         size: TIMESTAMP_BYTES,
         type: "NumberLike",
         description: 
`

`
      },
      {
         key: "endBlock",
         size: BLOCKNUMBER_BYTES,
         type: "NumberLike",
         description: 
`

`
      },
      {
         key: "amount",
         size: AMOUNT_BYTES,
         type: "NumberLike",
         description: 
`

`
      },
      {
         key: "paymentReference",
         size: PAYMENT_REFERENCE_BYTES,
         type: "NumberLike",
         description: 
`

`
      },
      {
         key: "dataAvailabilityProof",
         size: DATA_AVAILABILITY_BYTES,
         type: "BytesLike",
         description: 
`

`
      },
   ],
   dataHashDefinition: [
      // {
      //    key: "attestationType",
      //    type: "uint16"
      // },
      // {
      //    key: "chainId",
      //    type: "uint16"
      // },
      {
         key: "endTimestamp",
         type: "uint64",
         description:
`
End timestamp specified in attestation request.
`
      },
      {
         key: "endBlock",
         type: "uint64",
         description:
`
End block specified in attestation request.
`
      },
      {
         key: "destinationAddress",
         type: "bytes32",
         description:
`
Payment nonexistence is confirmed if there is no payment transaction (attestation of \`PaymentProof\` type)
with correct \`(destinationAddress, paymentReference, amount)\` combination
and with transaction status 0 (success) or 2 (failure, receiver's fault). 
Note: if there exist only payment(s) with status 1 (failure, sender's fault) 
then payment nonexistence is still confirmed.
`
      },
      {
         key: "paymentReference",
         type: "uint128",
         description:
`
`
      },
      {
         key: "amount",
         type: "uint128",
         description:
`
`
      },
      {
         key: "firstCheckedBlock",
         type: "uint64",
         description:
`
The first (confirmed) block that gets checked. It is the block that has timestamp (median time) 
greater or equal to \`endTimestamp - CHECK_WINDOW\`. 
f-asset: check that \`firstCheckBlock <= currentUnderlyingBlock\` at the time of redemption request.
`
      },
      {
         key: "firstCheckedBlockTimestamp",
         type: "uint64",
         description:
`
Timestamp of the firstCheckedBlock.
`
      },
      {
         key: "firstOverflowBlock",
         type: "uint64",
         description:
`
The first confirmed block with \`timestamp > endTimestamp\` and \`blockNumber  > endBlock\`. 
f-asset: check that \`firstOverflowBlock > last payment block\` (\`= currentUnderlyingBlock + blocksToPay\`).
`
      },
      {
         key: "firstOverflowBlockTimestamp",
         type: "uint64",
         description:
`
Timestamp of the firstOverflowBlock.
f-asset: check that \`firstOverflowBlockTimestamp > last payment timestamp\` 
     (\`= currentUnderlyingBlockTimestamp + time to pay\`). 
`
      },
   ]
}