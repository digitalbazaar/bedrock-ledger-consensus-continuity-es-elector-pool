# bedrock-ledger-consensus-continuity-es-elector-pool

## Install

```
npm i --save bedrock-ledger-consensus-continuity-es-elector-pool
npm i --save bedrock bedrock-ledger-node bedorkc-ledger-utils
```

## Usage

In your ledger config:

```js
config['ledger-core'].config = { 
  '@context': constants.WEB_LEDGER_CONTEXT_V1_URL,
  type: 'WebLedgerConfiguration',
  ledger: 'urn:ledger:36433d7c-a84d-4998-bb20-79e8581912ec',
  consensusMethod: 'Continuity2017',
  electorSelectionMethod: {
    type: 'ElectorPoolElectorSelection',
    electorPool: 'did:elector:060239ac-0631-4075-953a-7e61d9ee8c06'
  },  
  sequence: 0
};
```

You will also need to load the elector pool in your project

`/lib/index.js`
```js
require('bedrock-ledger-consensus-continuity-es-elector-pool')
```
