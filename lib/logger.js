/*!
 * Copyright (c) 2019-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');

module.exports =
  bedrock.loggers.get('app').child(
    'bedrock-ledger-consensus-continuity-ws-witness-pool');
