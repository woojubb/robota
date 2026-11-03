---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-session': patch
---

Edit checkpoints can be sealed, and every `EditCheckpointStore` now states how it keeps them.

- `EditCheckpointStore` requires `sealing`: `{ sealer }` seals every manifest and pre-image, bound to
  its session, turn and pre-image number so one moved elsewhere does not open there; `'plain'` keeps
  them as they are. `stateStorage` only says where they live (the project's checkpoint directory when
  omitted), and `sealedOnly: true` is for state made for one process, which never held a plain
  checkpoint. A sealed store numbers new checkpoints from directory names alone and refuses with
  `EditCheckpointNumberingExhaustedError` at the highest number, after which an interactive turn runs
  without a checkpoint and its history says why.
- `IEditCheckpointStateStorage` requires `replaceBytes(path, content, purpose)`, which replaces a file
  whole; `createDirectoryEditCheckpointState` and the project's checkpoint state have it.
- A checkpoint that cannot be read (damaged, written by a newer build, or sealed and locked) is
  reported instead of failing the whole read: `EditCheckpointsLockedError` (an `ArtifactLockedError`
  with its `reason`) for locked keys or no keys, `EditCheckpointUnreadableError` for a restore or
  rollback range holding one, refused before any project file is written. The store takes an optional
  `keysLocked` gate, and `countUnreadable()` and `listing()` say how many `list()` left out. `/rewind
list` prints that count and `/rewind inspect` marks a recorded size and a plan that would be refused.
- The branch head moves to a new checkpoint only once its manifest is written; a failed write used to
  leave the head on the unwritten checkpoint, so the next turn became its own parent and walking its
  ancestors never ended. `CheckpointTree.ancestors` (`@robota-sdk/agent-session`) also stops where
  parent edges loop back.

What to do: pass `sealing: 'plain'` to every `new EditCheckpointStore(...)` that does not seal, and add
`replaceBytes` to a storage of your own.
