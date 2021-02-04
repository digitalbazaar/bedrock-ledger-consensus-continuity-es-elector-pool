/*!
 * Copyright (c) 2019-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const brLedgerNode = require('bedrock-ledger-node');
const brLedgerUtils = require('bedrock-ledger-utils');
const logger = require('./logger');
const xor = require('buffer-xor');

// specify the consensus plugin(s) that work with this elector selection method
exports.consensusMethod = 'Continuity2017';

exports.type = 'WitnessPoolWitnessSelection';

// register this ledger plugin
bedrock.events.on('bedrock.start', () => brLedgerNode.use(
  exports.type, {api: exports, type: 'witnessSelection'}));

exports.getBlockWitnesses = async ({
  ledgerNode, ledgerConfiguration, latestBlockSummary, blockHeight
}) => {
  const result = await brLedgerUtils.getWitnessPoolWitnesses(
    {ledgerConfiguration, ledgerNode});
  const {maximumWitnessCount} = result;

  let {witnessPoolWitnesses} = result;
  witnessPoolWitnesses = Object.values(witnessPoolWitnesses);

  const {witnesses} = await exports._computeWitnesses({
    blockHeight, witnessPoolWitnesses, latestBlockSummary, ledgerConfiguration,
    ledgerNode, maximumWitnessCount
  });

  logger.verbose(
    'Selected Witnesses:',
    {ledgerNode: ledgerNode.id, blockHeight, witnesses});

  return {
    // number of witnesses, must be 3f+1 (or 1 for dictator model), safe
    // for up to `f` byzantine failures
    witnesses
  };
};

// it is useful to override this function in tests
exports._computeWitnesses = async ({
  witnessPoolWitnesses, latestBlockSummary,
  ledgerNode, maximumWitnessCount
}) => {
  // the genesis node functions as a dictator until the witness pool document
  // is established
  if(witnessPoolWitnesses.length === 0) {
    const {getMergeEventPeers} = ledgerNode.storage.events
      .plugins['continuity-storage'];
    const [genesisPeer] = await getMergeEventPeers({blockHeight: 0});
    return {witnesses: [{id: genesisPeer}]};
  }

  const {blockHash} = latestBlockSummary.eventBlock.meta;
  const baseHashBuffer = Buffer.from(blockHash);
  // the hash of the previous block is combined with the witness id to
  // prevent any witness from *always* being sorted to the top
  witnessPoolWitnesses.sort((a, b) => {
    // generate and cache hashes
    a._hashBuffer = a._hashBuffer || xor(baseHashBuffer, Buffer.from(a.id));
    b._hashBuffer = b._hashBuffer || xor(baseHashBuffer, Buffer.from(b.id));

    // sort by hash
    return Buffer.compare(a._hashBuffer, b._hashBuffer);
  });

  // include only `id` value in returned witnesses
  const witnesses = [];
  for(const witness of witnessPoolWitnesses) {
    witnesses.push(witness.id);
  }

  // TODO: allow the witness pool document to specify a witness count. Use the
  // value from the witness pool document first if available and if absent,
  // use the value specified in the ledger configuration
  const witnessCount = Math.min(
    witnesses.length, maximumWitnessCount || witnesses.length);

  // adjust witness count to the form 3f+1
  witnesses.length = _computeTargetWitnessCount(witnessCount);

  return {witnesses};
};

function _computeTargetWitnessCount(originalCount) {
  if(originalCount < 4) {
    return 1;
  }
  // compute target length
  const f = Math.floor(originalCount / 3);
  return 3 * f + 1;
}
