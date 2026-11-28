---
'@robota-sdk/agent-roundtable': minor
---

Add `@robota-sdk/agent-roundtable/node` with `FileConversationStore`, a durable `ConversationStore` over a local directory for one host. Each commit is an immutable revision file published create-only, claims and their fence are one record replaced atomically under a per-conversation lock, every file read is validated, and a damaged file throws `FileStoreCorruptionError` instead of being repaired. It passes both the backend and the durable conformance suites and is checked against real process kills. The package root stays platform-neutral and dependency-free.
