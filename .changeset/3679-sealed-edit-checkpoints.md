---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-session': patch
---

Edit checkpoints can be sealed. `createSealedEditCheckpointState(state, sealing, options?)` wraps any
`IEditCheckpointStateStorage`: `'plain'` returns it unchanged, `{ sealer }` seals every manifest and
pre-image bound to its session, turn and pre-image number, so one moved elsewhere does not open
there. Sealing needs `state` to replace a file whole: `IEditCheckpointStateStorage` gains an optional
`replaceBytes`, which `createDirectoryEditCheckpointState` and the project's own checkpoint state
implement, and each sealed manifest is replaced through it, so a crash never leaves a torn one. An
`EditCheckpointStore` given such state numbers new checkpoints from its directory names alone
(never reusing an earlier checkpoint's directory, even while its manifests cannot be opened, and
refusing with `EditCheckpointNumberingExhaustedError` at the highest number, after which an
interactive turn runs without a checkpoint and its history says why), believes a manifest only where
its id, sequence and session match its place, and a plain one only where it is numbered below every
sealed one (with `{ sealedOnly: true }`, for state that never held a plain checkpoint, none at all).
That stops a plain manifest being appended above sealed ones; with no trust anchor in the state, it
cannot stop a program of the same user replacing sealed manifests with plain ones. A manifest that
cannot be read, or a turn directory that cannot be listed — no permission, a link, not a regular
file, past the read limit — counts as damaged instead of failing the whole read, and such a directory
keeps its number. A resumed branch pointer is applied when the
checkpoint it names holds a manifest file, which is told without opening it. The store caps a sealed
pre-image so its file stays within the project read limit, records each pre-image's size
(`byteLength`) so `inspect` opens none (`snapshotSizeSource: 'recorded'`), and restores or rolls back
all or nothing: a range holding a checkpoint that does not open, or a pre-image that does not, is
refused with `EditCheckpointUnreadableError` before any project file is written, and the inspection
plan names it as `blockedBy`; of the pre-images it verifies, only the one that decides a file's
content is kept until it is written. Reads refused because the keys are locked, or because this
process has none, throw `EditCheckpointsLockedError` (an `ArtifactLockedError` with `reason`). The
store takes an optional `keysLocked` gate that refuses a person's reads while it says so, and
`countUnreadable()` says how many checkpoints `list()` left out as damaged or written by a newer
build; `listing()` returns both from one read (`IEditCheckpointListing`). The command host's optional
`unreadableEditCheckpoints()` and `editCheckpointListing()` carry them, and `/rewind list` prints the
count beneath the list from one read, through `readCommandEditCheckpointListing`. `/rewind inspect`
marks a recorded size and a plan that would be refused.

In every store, the branch head moves to a new checkpoint only once its manifest is written: a
manifest write that failed used to leave the head on the unwritten checkpoint, so the next turn,
taking its number, became its own parent and walking its ancestors never ended.
`CheckpointTree.ancestors` (`@robota-sdk/agent-session`) also stops where parent edges loop back.

Rolling back through a session's first checkpoint now starts the next turn on a fresh root line, as
documented, instead of continuing the line that was rolled back — for the rest of that process. A
resumed session continues from its latest checkpoint again: recording the cleared head would add a
key to the session record, which other 3.0 builds read strictly and would report as corrupt. Plain
checkpoint state is otherwise read and written exactly as before.

What to do: nothing; a store without sealed state behaves as before. A storage of your own that is
given to `createSealedEditCheckpointState` implements `replaceBytes`.
