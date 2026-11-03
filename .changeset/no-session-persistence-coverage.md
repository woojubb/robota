---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-cli': patch
---

`--no-session-persistence` now also covers what a run writes besides its session record: edit checkpoints live in an owner-only, per-process directory that is removed when the run ends (so `/rewind` still works within the run), subagent transcripts are not written, and prompts are not added to the prompt history.

`EditCheckpointStore` takes an optional `stateStorage` (`IEditCheckpointStateStorage`) for where its manifests and file pre-images are kept, and `createDirectoryEditCheckpointState(directory)` builds one over an owner-only directory. Without it the store keeps writing under the project, as before.
