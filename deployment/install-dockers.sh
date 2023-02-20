#!/bin/bash

NETWORK="$1"

if [[ $NETWORK == mainnet || $NETWORK == testnet ]] ; then
   echo "Installing dockers for: $NETWORK"
   cd indexers-$NETWORK

   ./install.sh xrp ../node-configs/$NETWORK/ripple/
   ./install.sh btc ../node-configs/$NETWORK/bitcoin/
   ./install.sh doge ../node-configs/$NETWORK/dogecoin/

   cd ../attestation-client

   ./install.sh  
else
  echo "Invalid network: '$NETWORK'"
fi



