/*!
 * Copyright (c) 2019-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const brLedgerNode = require('bedrock-ledger-node');
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
  const result = await _getWitnessPoolWitnesses(
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

// FIXME: determine if these functions should be updated in
// `bedrock-ledger-utils`

/**
 * Extracts the location of the elector pool document from ledgerConfiguration,
 * dereferences the elector pool document and returns service endpoints for
 * all the electors specified in the elector pool document.
 *
 * @param {Object} ledgerConfiguration the ledger configuration.
 * @param {Object} ledgerNode a LedgerNode instance.
 *
 * @return {Promise<Object>} the service endpoints for elector pool electors.
 * @throws if there is difficulty dereferencing any service descriptors.
 */
async function _getWitnessPoolWitnesses({ledgerConfiguration, ledgerNode}) {
  const {electorPool: electorPoolDocId} =
    ledgerConfiguration.electorSelectionMethod;
  if(!electorPoolDocId) {
    return {};
  }
  // get the electorPool document. Do not specify a maxBlockHeight because the
  // most recent revision is always required
  let electorPoolDocument;
  try {
    electorPoolDocument = await ledgerNode.records.get(
      {recordId: electorPoolDocId});
  } catch(e) {
    if(e.name === 'NotFoundError') {
      // the electorPool document has not been defined yet.
      return {
        electorPoolDocumentSequence: 0,
        electorPoolElectors: [],
        maximumElectorCount: 0
      };
    }
    throw e;
  }

  const {
    meta: {sequence: electorPoolDocumentSequence},
    record: {electorPool, maximumElectorCount},
  } = electorPoolDocument;

  if(!electorPool) {
    // veres-one-validator must ensure that this does not occur
    throw new BedrockError(
      'Elector pool document does not contain `electorPool`',
      'InvalidStateError', {electorPoolDocument});
  }

  return {
    electorPoolDocumentSequence,
    electorPoolElectors: await _dereferenceElectorPool(
      {electorPool, ledgerNode}),
    maximumElectorCount,
  };
}

/**
 * Dereferences the service descriptors for the electors listed in electorPool.
 *
 * @param {Object[]} electorPool an array of electors.
 * @param {Object} ledgerNode a LedgerNode instance.
 *
 * @return {Promise<Object>} the service endpoints for the electors.
 * @throws if there is difficulty dereferencing any service descriptors.
 */
async function _dereferenceElectorPool({electorPool, ledgerNode}) {
  const electors = {};

  // FIXME: is type an array or a string?  Value is TBD
  const continuityServiceType = 'Continuity2017Peer';

  for(const e of electorPool) {
    // service may be a string referencing a serviceId contained in a DID
    if(typeof e.service === 'string') {
      // extract the DID from `service` which is a DID followed by a fragment
      const recordId = e.service.substr(0, e.service.indexOf('#'));

      // dereference elector's DID document to locate the service descriptor
      // `records.get` throws NotFoundError on an unknown recordId
      const {record} = await ledgerNode.records.get({recordId});

      const {service: electorService} = record;
      const expectedService = {id: e.service, type: continuityServiceType};
      if(!electorService) {
        throw new BedrockError(
          'The Elector\'s DID document does not contain a service descriptor.',
          'NotFoundError', {elector: record, expectedService});
      }
      const service = find(electorService, expectedService);
      if(!service) {
        throw new BedrockError(
          'The Elector\'s DID document does not contain the expected ' +
          'service descriptor.', 'NotFoundError',
          {elector: record, expectedService});
      }
      electors[e.id] = {
        id: service.serviceEndpoint,
        type: e.type,
      };
    }

    // service may be an embedded service descriptor
    if(typeof e.service === 'object') {
      if(e.service.type === continuityServiceType &&
        e.service.serviceEndpoint) {
        electors[e.id] = {
          id: e.service.serviceEndpoint,
          type: e.type,
        };
      } else {
        // veres-one-validator must ensure that this never occurs
        throw new BedrockError(
          'Invalid service descriptor.', 'InvalidStateError', {elector: e});
      }
    }
  }

  // the current return map allows for correlation of elector DIDs to their
  // service endpoints
  return electors;
}
