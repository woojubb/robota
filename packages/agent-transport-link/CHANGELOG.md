# @robota-sdk/agent-transport-link

## 3.1.2
### Patch Changes

  - @robota-sdk/agent-keyring@3.1.2
  - @robota-sdk/agent-transport@3.1.2

## 3.1.1
### Patch Changes

  - @robota-sdk/agent-keyring@3.1.1
  - @robota-sdk/agent-transport@3.1.1

## 3.1.0
### Minor Changes

- 246c814: **Breaking (`@robota-sdk/agent-keyring`):** `IUnlockedKeys` is removed. `unlockWithPassphrase`,
  `unlockWithRecoveryKey` and `createKeyring` now return `IReadKeys`: the sealing keypair and the
  authorship key, with no attach keypair. `checkSealingPublicKey` and `repairSealingPublicKey` take the
  read keys. Code that read `unlocked.attach` has no replacement on the read keys: the attach key is
  reachable only inside `openOwnerHandover(keyring, credential)`, which certifies a runtime
  (`certify(instancePublicKey, binding)`) and proves the owner on an owner link, and never hands out a
  key.

  The keyring also gains the owner link: `startSpawnerExchange()` and `createRuntimeIdentity()` for the
  key a runtime shares with the process that started it, `createLinkInitiator()` and
  `createLinkResponder()` for the handshake in which the runtime proves itself first, sealed frames
  per direction, and a read grant that gives a runtime the read keys and never the attach key or the
  master key. Refusals are `LinkRefusedError`, whose `reason` names the failed check.

  `@robota-sdk/agent-transport-link` is published for the first time. It carries the owner link over a
  local byte stream (`serveRuntimeLink`, `openSpawnerLink`, `openOwnerLink`) with a strict owner
  vocabulary. It is dormant: nothing in the CLI or the desktop app uses it yet.

### Patch Changes

- Updated dependencies [bc8de21]
- Updated dependencies [246c814]
- Updated dependencies [437ca9e]
- Updated dependencies [b56b5a9]
  - @robota-sdk/agent-keyring@3.1.0
  - @robota-sdk/agent-transport@3.1.0
