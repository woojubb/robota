---
'@robota-sdk/agent-core': minor
---

The journal value codec is public: `encodeJournalValue` and `decodeJournalValue` write a journal record to JSON-safe text and back without losing dates, `undefined`, `-0`, shared references or cycles, and refuse what a journal cannot carry. Every durable journal can now encode execution records the same way.
