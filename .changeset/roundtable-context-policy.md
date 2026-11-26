---
'@robota-sdk/agent-roundtable': minor
---

A host can pass a `contextPolicy` to a roundtable to defer messages or consume them into a summary instead of offering every unseen message, and the policy's reference is saved with the conversation, so `loadRoundtable` resolves it through the new `registry.resolveContextPolicy` and refuses a missing or different one before any session opens.
