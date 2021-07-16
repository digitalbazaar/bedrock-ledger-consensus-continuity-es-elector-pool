/*!
 * Copyright (c) 2019-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const brLedgerNode = require('bedrock-ledger-node');
const crypto = require('crypto');
const logger = require('./logger');

// specify the consensus plugin(s) that work with this witness selection method
exports.consensusMethod = 'Continuity2017';

exports.type = 'WitnessPoolWitnessSelection';

// register this ledger plugin
bedrock.events.on('bedrock.start', () => brLedgerNode.use(
  exports.type, {api: exports, type: 'witnessSelection'}));

exports.getBlockWitnesses = async ({
  ledgerNode, ledgerConfiguration, latestBlockSummary, blockHeight
}) => {
  const result = await _getWitnessPoolWitnesses(
    {ledgerConfiguration, ledgerNode, blockHeight});
  const {
    maximumWitnessCount, primaryWitnessCandidates, secondaryWitnessCandidates
  } = result;

  const {witnesses} = await exports._computeWitnesses({
    latestBlockSummary, ledgerNode, maximumWitnessCount,
    primaryWitnessCandidates, secondaryWitnessCandidates
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
  latestBlockSummary, ledgerNode, maximumWitnessCount,
  primaryWitnessCandidates, secondaryWitnessCandidates}) => {
  // the genesis node functions as a dictator until the witness pool document
  // is established
  if(primaryWitnessCandidates.length === 0) {
    const {getMergeEventPeers} = ledgerNode.storage.events
      .plugins['continuity-storage'];
    const [genesisPeer] = await getMergeEventPeers({blockHeight: 0});
    return {witnesses: [genesisPeer]};
  }

  // the hash of the previous block is combined with the witness id to
  // prevent any witness from *always* being sorted to the top
  const {blockHash: seed} = latestBlockSummary.eventBlock.meta;
  const witnessSorter = _generateWitnessSorter({seed});
  primaryWitnessCandidates.sort(witnessSorter);
  secondaryWitnessCandidates.sort(witnessSorter);

  // if the maximum witness count is 1, switch into non-byzantine mode
  const witnesses = [];
  if(maximumWitnessCount === 1) {
    witnesses.push(primaryWitnessCandidates[0]);
    return {witnesses};
  }

  // calculate the number of primaries and total number of witnesses possible
  let numPrimaries;
  let numWitnesses;
  if(primaryWitnessCandidates.length <= 4) {
    numPrimaries = primaryWitnessCandidates.length;
    numWitnesses = 4;
  } else {
    const f = Math.min(
      Math.floor((primaryWitnessCandidates.length - 2) / 2),
      (maximumWitnessCount - 1) / 3);
    numPrimaries = (2 * f) + 2;
    numWitnesses = (3 * f) + 1;
  }

  // build the witness list from the primaries and then the secondaries
  if(witnesses.length < numPrimaries) {
    witnesses.push(...primaryWitnessCandidates.slice(
      0, numPrimaries - witnesses.length);
  }
  if(witnesses.length < numWitnesses) {
    witnesses.push(...secondaryWitnessCandidates.slice(
      0, numWitnesses - witnesses.length);
  }

  return {witnesses};
};

function _generateWitnessSorter({seed}) {
  return (a, b) => {
    // generate hashes
    const aDigest = crypto.createHash('sha256')
      .update(seed).update(a).digest();
    const bDigest = crypto.createHash('sha256')
      .update(seed).update(b).digest();

    // sort by hash
    return Buffer.compare(aDigest, bDigest);
  };
}

// FIXME: determine if these functions should be updated in
// `bedrock-ledger-utils`

/**
 * Extracts the location of the witness pool document from ledgerConfiguration,
 * dereferences the witness pool document and returns service endpoints for
 * all the witnesses specified in the witness pool document.
 *
 * @param {Object} ledgerConfiguration the ledger configuration.
 * @param {Object} ledgerNode a LedgerNode instance.
 *
 * @return {Promise<Object>} the service endpoints for witness pool witnesses.
 * @throws if there is difficulty dereferencing any service descriptors.
 */
async function _getWitnessPoolWitnesses({
  ledgerConfiguration, ledgerNode, blockHeight}) {
  const {witnessPool: witnessPoolDocId} =
    ledgerConfiguration.witnessSelectionMethod;
  if(!witnessPoolDocId) {
    return {};
  }
  // get the witnessPool document. Do not specify a maxBlockHeight because the
  // most recent revision is always required
  let witnessPoolDocument;
  try {
    witnessPoolDocument = await ledgerNode.records.get(
      {maxBlockHeight: blockHeight - 1, recordId: witnessPoolDocId});
  } catch(e) {
    if(e.name === 'NotFoundError') {
      // the witnessPool document has not been defined yet.
      return {
        id: witnessPoolDocId,
        type: 'WitnessPool',
        maximumWitnessCount: 0,
        primaryWitnessCandidates: [],
        secondaryWitnessCandidates: []
      };
    }
    throw e;
  }

  const {record} = witnessPoolDocument;
  return {
    id: witnessPoolDocId,
    type: 'WitnessPool',
    maximumWitnessCount: record.maximumWitnessCount,
    primaryWitnessCandidates:
      bedrock.util.clone(record.primaryWitnessCandidate),
    secondaryWitnessCandidates:
      bedrock.util.clone(record.secondaryWitnessCandidate)
  };
}
