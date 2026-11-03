---
'@robota-sdk/agent-core': minor
---

`@robota-sdk/agent-core` adds the sealer port that secure conversation seals artifacts through:
`IArtifactSealer` (with `IArtifactContext`, `TArtifactKind` and an optional `writeGrant()` that hands
sealing to another process without a secret), `TArtifactSealing` (`{ sealer } | 'plain'`, how every
store states its sealing), `ArtifactLockedError` and `ArtifactCorruptError` with their guards, the sealed framing checks (`isSealedArtifactBytes`, `isSealedArtifactLine`, ...), and
`createTestArtifactSealer` and `openTestWriteGrant` in `@robota-sdk/agent-core/testing`.
`@robota-sdk/agent-core/node` adds the process identity readers (`readCurrentProcessIdentity`,
`readBootId`, `readPidNamespace`, `readProcessStartTime`), and `writeOwnerOnlyFile` now also writes
bytes and takes `durable`, `createOnly`, `beforeCommit`, `temporaryPath` and `linkFile`; a failure
after the new content is in place throws `OwnerOnlyWriteUnconfirmedError`. `ensureOwnerOnlyDirectory`
takes `durable` (flush the parent of every directory it creates) and `syncDirectory`.

What to do: nothing.
