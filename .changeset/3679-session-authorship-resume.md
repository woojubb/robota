---
'@robota-sdk/agent-interface-session': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-subagent-runner': patch
'@robota-sdk/agent-ui-terminal': patch
'@robota-sdk/agent-cli': patch
---

A record a store that seals does not verify as the owner's is never resumed, chosen or vouched for
without the owner's word.

- Resume: `-c` continues the newest verified session and stops when a newer unverified one exists
  (asking at a terminal, exiting elsewhere). `-r` takes a verified or plain record's exact id, then
  such a record's name, then any other record's id, and refuses a text that is both a verified
  record's name and the id of a record that is unverified or does not read
  (`ambiguousSessionNameMessage`); a store that never seals has no verified record, so there an
  exact id answers before a name and nothing is refused as ambiguous. Breaking:
  `resolveSessionIdByIdOrName` returns a `TSessionIdResolution` (`found`, `ambiguous` with `namedId`
  and `otherId`, `not-found`) instead of an id. An unverified id, or one picked in the picker, is
  shown in fixed text (`unverifiedSessionNotice`, `UNVERIFIED_SESSION_QUESTION`) and asked about —
  before startup only when stdin, stdout and stderr are all a terminal; a yes hands the session the
  digest of exactly the bytes shown. Surfaces with no one to ask refuse
  it, a served switch with the new change-refusal code `unverified`. Listings put unverified records
  after verified ones, the picker marks them first and cuts their names short, and
  `session list --json` adds `authorship`.
- Forks: a child handed a sealed record runs it only when the parent held it as the owner's, and
  reports each save of it as the new `record_saved` member of
  `TSubagentWorkerChildMessage`, and the parent vouches for the last one once the child is gone, when
  the job started from the owner's own record and no save was refused.
- Migration: `secure migrate` offers once, at the end of a finished interactive run, to mark the
  sessions it sealed from plaintext (`sealedRecords` on the migration results) as yours. Each store
  is marked on its own; one it could not reach is named, and records the keys locked before marking
  are said to be not marked, to be marked when resumed, apart from changed ones.

What to do: handle `unverified` and `record_saved` where you switch on `TSessionChangeRefusalCode`
or `TSubagentWorkerChildMessage`, and read `resolveSessionIdByIdOrName`'s `status`.
