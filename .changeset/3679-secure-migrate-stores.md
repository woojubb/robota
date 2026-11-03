---
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
---

`secure migrate`, still reserved for secure mode (which cannot be turned on yet), now converts every
conversation store after the prompt history: the user's session records, the subagent transcripts,
and the state of each project that is trusted now, on a host that can write project state — its
session records, replay logs and their payload files, edit checkpoints, and pending memory
candidates, which are deleted. A record is sealed as the bytes it holds, so a damaged record is
still reported as damaged; a log becomes one sealed record per line, and its payload files are
sealed under the names they had, so every reference still resolves; edit checkpoints are sealed
newest turn first, and a turn that cannot be sealed stays plain with every older one. A store's
session records are all written sealed and flushed beside their originals before any is replaced,
and so are a session's payload files; a log is then replaced on its own, after its payload files,
and edit checkpoints one turn at a time. A file with another hard link is left as it is and listed,
since replacing it would leave the plaintext under the other name; plain checkpoint data a sealing
store would read as damaged — a plain manifest above a sealed one, or a plain pre-image under a
sealed manifest with no staged sealed copy — is listed and never sealed. It then deletes what
earlier runs left behind: temp files of crashed writes (judged against when the migration started,
so one in a directory nothing touched since is found), sessions kept aside during a hand-off,
`/editor` buffers older builds left in the shared temporary directory and nobody touched for a day,
and the scratch directories of processes that are gone. After typing `proceed` past a process that
cannot be checked, none of those leftovers and no pending memory candidates are deleted. Untrusted
and non-Linux projects, the SDK's spill directories, anything that does not open with this keyring,
and entries that cannot be read are listed and left as they are; a link is never followed. Recorded
projects are probed a few at a time, each by git in a child process, and one on a mount that does
not answer is listed as unreachable after a timeout; where git cannot be started, a look bounded by
the same timeout stands in, and once one look has not answered every project left is listed as
unreachable. Each step plans with the walk it runs, so `--dry-run` shows exactly what a run would do
and changes nothing on disk (not even a trust store's mode; the one write it can cause is the
unlock's repair of a swapped sealing key, which it says), and checks for other product processes
before every write. Anything it must leave as it is while it still holds plaintext — the history, a
link, a file with another name, in every store — a catch-up that failed, or a file that changed
meanwhile ends the run incomplete (exit 5), and the summary says what to move aside first; a run
stopped part-way finishes when started again, and until then `/rewind` says to run it again for a
checkpoint whose staged sealed copy is still waiting. On macOS the plan's caveat says the flushes
stop at the drive's own cache.

`@robota-sdk/agent-session` adds `migrateNodeSessionStore`, `readSessionStoreWorkingDirectories`,
`migrateSessionLogDirectory` and `readPromptHistoryProjects`, with the format helpers they share:
`storedSessionMigrationState`, `sealStoredSessionBytes`, `storedPayloadMigrationState`,
`sealStoredPayloadBytes`, `sealSessionLogText` and `countPlainSessionLogLines`.
`@robota-sdk/agent-framework` adds `migrateWorkspaceProjectSessionRecords`,
`migrateWorkspaceProjectSessionLogs`, `migrateWorkspaceEditCheckpoints` and
`migrateSubagentTranscripts`; `EditCheckpointUnreadableError` gains `unfinishedMigration` for a
pre-image still plain under its sealed manifest beside a staged sealed copy that opens; and
`createNodeWorkspaceTrustStore(path, { tightenOnRead: false })` reads a trust store without narrowing
its mode. `@robota-sdk/agent-command`'s `/rewind` then names `<cli> secure migrate`. Nothing calls the
converters outside a migration, and plain mode writes exactly what it did before.

What to do: nothing.
