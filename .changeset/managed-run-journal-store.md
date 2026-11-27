---
'@robota-sdk/agent-session': minor
---

`@robota-sdk/agent-session/node` gains `NodeExecutionJournalStore`, a durable, append-only, fsynced and idempotent execution journal kept in the session store's directory (`journals/<session>/`). Each execution can be sealed (`completed`, `failed`, `abandoned`), which refuses further appends; a torn or corrupt journal is refused rather than repaired and can still be abandoned without being opened. The main entry exports the neutral `IExecutionJournalStore` / `ISessionExecutionJournal` ports and `ExecutionJournalStoreError`. Deleting a session in `NodeSessionStore` also removes its journals.
