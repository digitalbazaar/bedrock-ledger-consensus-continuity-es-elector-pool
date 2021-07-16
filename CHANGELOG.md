# bedrock-ledger-consensus-continuity-ws-witness-pool Change Log

## 2.0.0 - 2021-07-xx

### Changed

- Rename 'elector' to 'witness' to more accurately convey the role.
- Remove dependency on buffer-xor.

### Added

- **BREAKING**: Create and use new witness pool document format.
- Ensure witness pool is deterministically randomized per block.
- Add two tiers of witnesses; primary (very low expected risk of failure) and secondary
  (can all fail if 1 or fewer primaries do not) witnesses. Byzantine fault tolerance is still `3f+1`.
  The witness selection algorithm will select `2f+2` witnesses from the primary list and
  the remainder from the secondary list. If only 4 witnesses are to be selected, all will
  selected from the primary list. This always ensures that consensus can still be
  reached even if 1 witness from the primary list and all witnesses from the secondary
  list fail. Additional witnesses from the primary list may fail so long as each failure is
  replaced with a non-failure from the witnesses from the secondary list.

## 1.0.0 - 2019-12-16

### Added

- Initial implementation of electors.
- Allow maximumElectorCount to be undefined.
- Set electors to 1 if there are less than 4.
