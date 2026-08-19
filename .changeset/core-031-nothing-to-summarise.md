---
'@robota-sdk/agent-session': patch
---

CORE-031: a compaction with nothing to summarise no longer replaces the conversation

`Session.compact()` guarded on the FULL conversation and then compacted a DIFFERENT array — the same
history with system messages filtered out. So a conversation consisting only of system messages
passed the guard, reached the orchestrator empty, took its `return ''` shortcut, and came back as a
"summary" the caller wrote over the conversation: cleared, and replaced with an empty
`[Context Summary]` block.

The guard now tests the messages that will actually be compacted. Nothing to summarise is a no-op,
not a failure — the conversation is left exactly as found, no hook fires, no `context_compact` event
is written, and the provider is not called.

`CompactionOrchestrator.compact()` correspondingly throws `CompactionError` on an empty `history`
rather than returning `''`, which contradicted the contract two lines above it in its own docblock
("always a non-empty string") and was the value that made the overwrite possible. Whether there is
anything worth compacting is the caller's judgement, made before it commits to replacing anything.

Reachable from the public SDK surface: `Session.injectMessage` is what `--resume` and `--fork` drive
on every restore.
