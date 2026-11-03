---
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
---

`secure migrate`, still reserved for secure mode (which cannot be turned on yet), now converts every
conversation store after the prompt history: the user's session records, the subagent transcripts,
and the state of each trusted project on a host that can write project state (session records, replay
logs with their payload files, edit checkpoints, and pending memory candidates, which are deleted). It
then deletes what earlier runs left behind: temp files of crashed writes, sessions kept aside during a
hand-off, `/editor` buffers in the shared temporary directory and the scratch directories of
processes that are gone. What it cannot seal safely (a link or a file with another hard link,
untrusted and non-Linux projects, the SDK's spill directories, anything that does not open with the
keyring) is listed and left as it is. `--dry-run` shows exactly what a run would do and changes
nothing. A run that leaves plaintext which a rerun or moving a file aside would remove ends
incomplete (exit 5) and says what to do; plaintext it can never seal (a project record or log past
the project read limit once sealed, checkpoint turns kept plain) is listed, and the run still ends
done. A run stopped part-way finishes when started again. `/rewind` names `<cli> secure migrate`
for a checkpoint whose sealed copy is still waiting.

`@robota-sdk/agent-session` adds `migrateNodeSessionStore`, `readSessionStoreWorkingDirectories`,
`migrateSessionLogDirectory`, `readPromptHistoryProjects` and the format helpers they share.
`@robota-sdk/agent-framework` adds `migrateWorkspaceProjectSessionRecords`,
`migrateWorkspaceProjectSessionLogs`, `migrateWorkspaceEditCheckpoints` and
`migrateSubagentTranscripts`; `EditCheckpointUnreadableError` gains `unfinishedMigration`; and
`createNodeWorkspaceTrustStore(path, { tightenOnRead: false })` reads a trust store without narrowing
its mode. Nothing calls the converters outside a migration.

What to do: nothing.
