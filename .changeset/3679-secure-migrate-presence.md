---
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-core': minor
---

Every CLI process that builds a conversation store — a session store, the prompt history, the
tool-result spill, edit checkpoints — now records that it is running: the first time it builds one,
it creates an owner-only directory under `presence/` in its state root holding its pid, start time,
boot and pid namespace and how it was started (interactive, print, serve, ...), and removes it when
it ends, including on a hangup, interrupt or termination. A subagent worker does the same when it
binds the grant its parent sends. One left by a process that was killed outright is removed by the
next start once its pid has ended (a start reads no process start times, so one whose pid was reused
waits for `secure migrate`, which judges every presence fully), as is one that a crash left without
its owner record. This is the one change on disk in plain mode; everything else is written exactly as
before. A command that builds no store creates none. A presence that cannot be created is reported
once on stderr and the session goes on.

`secure migrate [--dry-run]` and `secure compact` are reserved for secure mode, which cannot be turned
on yet: until it can, both refuse with a fixed message and write nothing, and neither is listed in the
usage. Once it can, `secure compact` unlocks at the terminal, marks itself as `secure migrate` does,
refuses while a migration or another compaction runs, and rewrites the prompt history with every
entry sealed, one per line, under one key; `secure migrate` unlocks, refuses while another process
uses the stored conversations or another migration may be running, prints its plan and what it
cannot erase on stdout, asks, and runs. Each flushes its marker's owner record before it looks any
further. A process that starts while a migration runs — or while a migration marker whose owner
cannot be checked from here is present — refuses to open its stores; a compaction holds none up.
Neither command is a slash command, a skill or anything a transport can reach.

`@robota-sdk/agent-session` adds `compactPromptHistoryFile(path, { sealer })` and
`inspectPromptHistoryFile(path, { sealer })`. Compaction seals every entry, plain or sealed, one per
line under the sealer it is given, replaces the file by rename and catches up what terminals appended
meanwhile; lines that do not open, or that a newer build sealed, are carried over unchanged. It
refuses a history that is a symbolic link or has another hard link (`status: 'refused'`), abandons
its rename when another compaction replaced the file first (`status: 'replaced'`) or the file was
deleted meanwhile (`status: 'removed'`, nothing put back), reports plain lines that reached the new
file during the swap (`plainLinesAfter`), and reports a catch-up that failed with how many bytes of
the replaced file it left unread (`catchUpFailed`). A crash or failure during the catch-up can lose
prompts appended in those milliseconds; the session records hold them too.

`@robota-sdk/agent-core/node` adds `inspectProcessScopedDirectories(parent, prefix)`, which says for
each process-scoped directory whether its owner is `alive`, `gone` or `unknown` and removes nothing;
`createProcessScopedDirectory` takes an optional `readStartTime` for the owner record, so a host
that can read a Windows process creation time records it, and `durable` (with the `syncFile` and
`syncDirectory` seams), which flushes the owner record and its directory before it returns; and
`stageOwnerOnlyFile(path, content)` writes and flushes an owner-only temp file beside its target and
puts it in place only on `commit()`, so a caller replacing many files can flush all of them before
renaming any.

What to do: nothing. A tool that lists the state root may see the `presence/` directory while a
process runs.
