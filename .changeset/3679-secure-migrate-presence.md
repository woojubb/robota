---
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-core': minor
---

Every CLI process that builds a conversation store (session records, prompt history, tool-result
spill, edit checkpoints) now records that it is running: an owner-only directory under `presence/` in
its state root holding its pid, start time and how it was started, removed when it ends, including on
a hangup, interrupt or termination. A subagent worker does the same when it binds the grant its
parent sends. The next start removes one a killed process left once its pid has ended. A command that
builds no store creates none, and a presence that cannot be created is reported once on stderr while
the session goes on. A tool that lists the state root may see `presence/` while a process runs.

`secure migrate [--dry-run]` and `secure compact` are reserved for secure mode, which cannot be turned
on yet: until it can, both refuse with a fixed message and write nothing, and neither is listed in the
usage. Neither is a slash command, a skill or anything a transport can reach.

`@robota-sdk/agent-session` adds `compactPromptHistoryFile(path, { sealer })`, which rewrites the
prompt history with every entry sealed, one per line, replaces the file by rename and catches up what
terminals appended meanwhile, and `inspectPromptHistoryFile(path, { sealer })`.
`@robota-sdk/agent-core/node` adds `inspectProcessScopedDirectories(parent, prefix)` and
`stageOwnerOnlyFile(path, content)`, and `createProcessScopedDirectory` takes `readStartTime` and
`durable`.

What to do: nothing.
