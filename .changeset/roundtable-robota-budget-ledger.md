---
'@robota-sdk/agent-roundtable-robota': minor
---

A roundtable conversation configured with a token or cost `budget` now refuses `sessionParticipant`, `runtimeParticipant` and `runtimeSelector` at construction and at load with `invalid-config`, because these adapters report usage but cannot declare a call's bound before it is dispatched. Conversations without a budget are unaffected.
