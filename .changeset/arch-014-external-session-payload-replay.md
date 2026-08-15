---
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-provider-replay': minor
---

Restore full-fidelity replay for session-log values externalized to content-addressed sidecar files.

`agent-session` now exports a bounded, containment- and integrity-checked recursive payload resolver,
hydrates JSONL logs at their read boundary, and rejects unresolved replay-substrate values during raw
validation. `agent-provider-replay` reuses that resolver for direct construction and file loading so
large recorded responses remain aligned with later calls.
