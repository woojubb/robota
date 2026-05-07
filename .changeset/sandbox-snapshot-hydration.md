---
'@robota-sdk/agent-sdk': minor
'@robota-sdk/agent-tools': minor
'@robota-sdk/agent-sessions': minor
---

Add provider-neutral sandbox snapshot hydration for interactive sessions. Snapshot-capable sandbox clients now persist `sandboxSnapshotId` on shutdown and restore it before saved message replay on non-fork resume, while the E2B structural adapter supports both `createSnapshot()`-style checkpoints and pause/resume sandbox references.
