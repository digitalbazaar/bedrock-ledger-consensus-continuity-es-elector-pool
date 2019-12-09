/*!
 * Copyright (c) 2019 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const brLedgerNode = require('bedrock-ledger-node');
const brLedgerUtils = require('bedrock-ledger-utils');
const logger = require('./logger');
const xor = require('buffer-xor');

// specify the consensus plugin(s) that work with this elector selection method
exports.consensusMethod = 'Continuity2017';

exports.type = 'ElectorPoolElectorSelection';

// register this ledger plugin
bedrock.events.on('bedrock.start', () => brLedgerNode.use(
  exports.type, {api: exports, type: 'electorSelection'}));

exports.getBlockElectors = async ({
  ledgerNode, ledgerConfiguration, latestBlockSummary, blockHeight
}) => {
  const result = await brLedgerUtils.getElectorPoolElectors(
    {ledgerConfiguration, ledgerNode});
  const {maximumElectorCount} = result;

  let {electorPoolElectors} = result;
  electorPoolElectors = Object.values(electorPoolElectors);

  const {electors} = await exports._computeElectors({
    blockHeight, electorPoolElectors, latestBlockSummary, ledgerConfiguration,
    ledgerNode, maximumElectorCount
  });

  logger.verbose(
    'Selected Electors:',
    {ledgerNode: ledgerNode.id, blockHeight, electors});

  return {
    // number of electors, must be 3f+1 (or 1 for dictator model), safe
    // for up to `f` byzantine failures
    electors,
    // Note: recovery mode is NOT supported by this module
    recoveryElectors: []
  };
};

// it is useful to override this function in tests
exports._computeElectors = async ({
  electorPoolElectors, latestBlockSummary,
  ledgerNode, maximumElectorCount
}) => {
  // TODO: we should be able to easily remove previously detected
  // byzantine nodes (e.g. those that forked at least) from the electors

  // the genesis node functions as a dictator until the electorPool document
  // is established
  if(electorPoolElectors.length === 0) {
    const {getMergeEventPeers} = ledgerNode.storage.events
      .plugins['continuity-storage'];
    const [genesisPeer] = await getMergeEventPeers({blockHeight: 0});
    return {electors: [{id: genesisPeer}], recoveryElectors: []};
  }

  const {blockHash} = latestBlockSummary.eventBlock.meta;
  const baseHashBuffer = Buffer.from(blockHash);
  // the hash of the previous block is combined with the elector id to
  // prevent any elector from *always* being sorted to the top
  electorPoolElectors.sort((a, b) => {
    // generate and cache hashes
    a._hashBuffer = a._hashBuffer || xor(baseHashBuffer, Buffer.from(a.id));
    b._hashBuffer = b._hashBuffer || xor(baseHashBuffer, Buffer.from(b.id));

    // sort by hash
    return Buffer.compare(a._hashBuffer, b._hashBuffer);
  });

  // _hashBuffer is no longer needed and should not appear in elector logging
  electorPoolElectors.forEach(e => delete e._hashBuffer);

  // TODO: allow the electorPool document to specify an electorCount. Use the
  // value from the electorPool document first if available and if absent,
  // use the value specified in the ledgerConfiguration.
  const electorCount = Math.min(
    electorPoolElectors.length, maximumElectorCount) ||
    electorPoolElectors.length;

  // adjust elector count to the form 3f+1
  electorPoolElectors.length = _computeTargetElectorCount(electorCount);

  return {electors: electorPoolElectors};
};

function _computeTargetElectorCount(originalCount) {
  if(originalCount < 4) {
    return 1;
  }
  // compute target length
  const f = Math.floor(originalCount / 3);
  return 3 * f + 1;
}
