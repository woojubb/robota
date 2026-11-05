---
'@robota-sdk/agent-framework': minor
---

Serialize each session's checkpoint writer and restore, and claim checkpoint directories atomically so concurrent processes cannot overwrite or reorder pre-images. Custom checkpoint-state hosts must supply the writer lease and atomic directory claim capabilities; custom project mutation boundaries must support atomic directory claims.
