---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-subagent-runner': minor
'@robota-sdk/agent-cli': minor
---

One session has one writer across processes. Every claim of a session id now holds the id's writer
marker in a `claims/` directory beside the records, so a second opener of a session another process
has open is refused with `has_writer`, naming that process — `-r`, `-c`, the resume picker, ACP
`session/load`, the served and desktop pool, a served switch, rename and delete. This is a break: a
session that two processes could open at once before is now refused in the second one.

`@robota-sdk/agent-core` adds exclusive process markers: the neutral `IProcessMarkers` port with its
result types, and `createProcessMarkers` on `./node`. A marker is published by hard-linking a flushed
temp file, moved or removed only under its break lock, and re-verified by its handle before each
write. The owner record and its liveness rule are now one exported classifier,
`classifyProcessOwner`, shared with process-scoped directories.

`@robota-sdk/agent-interface-session` and `@robota-sdk/agent-session`: `StoredSessionRecords` takes
the marker port, and a store without one does not exist. `claim(id, { lease })` takes over a lent
marker and `claim(id, { copy: true })` reads a record to copy it without one. `lend(id)` is new: it
lends a record to another process for as long as that process runs and returns `{ nonce, end() }`.
Every write of an id holds its marker, and a save whose marker another process broke is refused as
`released`, never written. `hasWriter` now sees other store instances and processes. Removed, since
`lend` replaces them: `ISessionAuthorship.exportEnded`, the store's export bookkeeping
(`hasUnclaimedWriter`), the `exported` claim refusal and the `exported` adopt result.
`TSessionClaimRefusal` is `has_writer | released`, `TSessionAdoptResult` has `has_writer` in place of
`exported`, and `has_writer` is a session change and delete refusal code. A store may name its release
command for a refusal (`releaseCommand`).

`@robota-sdk/agent-subagent-runner`: the parent lends a fork job's record before it spawns the child,
in either mode; the lease nonce rides on the start payload (`resumeLease`); the child claims its
record under the lease, saves under that claim and releases it on every exit; the parent ends the
lease once the child has exited and disconnected, then countersigns under its own marker. A running
child-process fork therefore has one writer, and attaching to it is refused until the job ends.

`@robota-sdk/agent-cli` adds `session release <id> [--force]`, the user's own command for a marker a
crashed or planted process left: on its own it removes only a marker whose process has ended, and
`--force` removes one whose process may still run only at a terminal and after a y/N. `secure migrate`
leaves a session open in another process as it is and names it.

A terminal start whose resumed session another process holds now ends with the store's refusal, as print
mode does, instead of Ink's error screen; `@robota-sdk/agent-framework` exports `claimRefusalMessage`
for it.
