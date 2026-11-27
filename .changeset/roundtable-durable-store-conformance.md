---
'@robota-sdk/agent-roundtable': minor
---

`@robota-sdk/agent-roundtable/testing` adds `runDurableConversationStoreConformance`, which runs the conversation store conformance cases and then checks across restarts that a store declaring `durability: 'durable'` keeps committed envelopes, operation receipts and fences, and leaves no trace of rejected writes.
