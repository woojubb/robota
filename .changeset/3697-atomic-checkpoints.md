---
'@robota-sdk/agent-framework': minor
---

Claim checkpoint directories atomically so concurrent processes cannot overwrite one another. Hosts that supply custom checkpoint state or project mutation boundaries must implement the atomic directory claim capability before creating checkpoints.
