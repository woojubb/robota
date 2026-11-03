---
'@robota-sdk/agent-core': minor
---

`@robota-sdk/agent-core` exports the artifact sealer port for secure conversation: `IArtifactSealer`
(with `IArtifactContext`, `TArtifactKind` and an optional `writeGrant()` that hands sealing to another
process without a secret, offered only by a sealer whose key outlives its process),
`ARTIFACT_KEY_REUSE` (whether each kind's artifacts may share a writer's
data key), `ArtifactLockedError` (with `reason: 'locked' | 'no-keys'`, `'locked'` by default) and
`ArtifactCorruptError` with their guards, the sealed framing (`SEALED_ARTIFACT_MAGIC`,
`SEALED_ARTIFACT_LINE_PREFIX`, `SEALED_ARTIFACT_MAX_OVERHEAD_BYTES` and the `isSealedArtifact*`
checks), and `createTestArtifactSealer` and `openTestWriteGrant` from `@robota-sdk/agent-core/testing`.
`writeOwnerOnlyFile` (`@robota-sdk/agent-core/node`) writes bytes as well as text and takes optional
`durable`, `createOnly`, `beforeCommit`, `temporaryPath` and `linkFile`; a failure after the new
content is in place throws `OwnerOnlyWriteUnconfirmedError`. The `/node` entry also exports the
process identity readers (`readCurrentProcessIdentity`, `readBootId`, `readPidNamespace`,
`readProcessStartTime`).

What to do: nothing; calls without the new options behave as before.
