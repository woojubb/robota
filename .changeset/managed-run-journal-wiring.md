---
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-product': minor
---

Managed turns can be journaled durably and recovered safely. `@robota-sdk/agent-session` adds `runJournaledTurn` (a managed turn through an `ISessionExecutionJournal`, sealed when it settles, refused behind an unresolved execution) and `abandonUnresolvedExecutions` (seals an unfinished execution as abandoned, so it can never be resumed, and reports what may already have happened outside), plus `Session.holdUnresolvedExecutions` / `releaseUnresolvedExecutions` for a crash the session's own history cannot show. `@robota-sdk/agent-framework`'s interactive session accepts a managed `provider`, an explicit `helperProvider` and an `executionJournals` store: a managed turn runs through the journal, a model-step turn is unchanged, unfinished executions found at start refuse input, and every code rewind ends the managed continuation. It gains `abandonUnresolvedExecutions()` on the command host and the `ABANDON_EXECUTION_COMMAND_DESCRIPTION` constant. `@robota-sdk/agent-product` adds the user-only `/abandon-execution` command, never offered to the model.
