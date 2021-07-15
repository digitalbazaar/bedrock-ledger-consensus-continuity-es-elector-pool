# bedrock-ledger-consensus-continuity-ws-witness-pool Change Log

## 2.0.0 - 2021-07-xx

### Changed

- Rename 'elector' to 'witness' to more accurately convey the role.
- Remove dependency on buffer-xor.

### Added

- **BREAKING**: Create and use new witness pool document format.
- Ensure witness pool is deterministically randomized per block.
- Add two tiers of witnesses; primary (not expected to fail) and secondary
  (can fail) witnesses. Byzantine fault tolerance is still 3f+1.

## 1.0.0 - 2019-12-16

### Added

- Initial implementation of electors.
- Allow maximumElectorCount to be undefined.
- Set electors to 1 if there are less than 4.
