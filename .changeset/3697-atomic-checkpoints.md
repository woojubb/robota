---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-core': minor
---

Serialize each session's checkpoint writer and restore, and claim checkpoint directories atomically so concurrent processes cannot overwrite or reorder pre-images. Custom checkpoint-state hosts and project mutation boundaries must supply writer leases and atomic directory claims. The Node core exposes process markers anchored to an open directory descriptor for host implementations.
