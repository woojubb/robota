# @robota-sdk/agent-keyring

## 3.2.2
### Patch Changes

- Refresh the package README so the npm page shows the current package layout, install steps and environment variable names.

## 3.2.1

## 3.2.0
### Minor Changes

- ffaf7d5: Add the runtime half of owner-link admission. Secure mode remains dormant until the product enables it.

  The transport provides the spawner-pair exchange and bounded delivery of queued link frames. The CLI
  uses the exchanged runtime identity to admit owner links, receives read grants without a passphrase,
  locks keys when access ends, and refuses unsecured listener and control paths. The child-session spawn
  paths can be held while a handed-over descriptor is consumed, and the runtime uses that hold during the
  exchange.

## 3.1.2

## 3.1.1

## 3.1.0
### Minor Changes

- bc8de21: `@robota-sdk/agent-keyring` is published for the first time (issue #3679, secure conversation). It
  keeps a master key wrapped by a passphrase and by a recovery key, derives the sealing and attach key
  pairs and an authorship key from it (`tagAuthorship`/`verifyAuthorship` on the unlocked keys: an
  HMAC-SHA256 tag only an unlocked keyring makes or checks), and seals artifacts to the sealing public
  key, on `node:crypto` only;
  `generateTransientSealingKeyPair()` makes a sealing key pair for a key that lives only in one
  process's memory. It is in the
  changeset fixed group, so it versions and publishes with the other `@robota-sdk/*` packages. Nothing
  depends on it unless you add it; the CLI uses it for `secure` keyring custody.
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
