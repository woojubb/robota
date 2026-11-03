---
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-ui-terminal': minor
'@robota-sdk/agent-command': minor
---

`NodeSessionStore`, `WorkspaceProjectSessionStore`, `createNodeHostSessionStore`,
`createUserSessionStore` and `createProjectSessionStore` take an optional last argument
`{ sealing }`: `{ sealing: { sealer } }` seals every record with an `IArtifactSealer` bound to its
session id, and `'plain'` (the default) writes the same JSON as before. A store that seals reads plain
records too and seals each one on its next save. `IWorkspaceProjectStateStorage` gains an optional
`replaceBytes`, which the framework's storage implements; the project session store uses it to
replace a record whole and falls back to `writeBytes` without it.

The append stores take the same option: `NodePromptHistoryFile` (and `createUserPromptHistoryFile`),
`NodeSessionLogSink`, `NodeSessionLogSource`, `NodeExternalPayloadSource` (with an optional
`ownerId`), `WorkspaceSessionLogSink` and `WorkspaceSessionLogSource`. A sealing store writes each
append as one sealed line, with a newline before and after it, and each log sidecar sealed under a
random name instead of its content hash; it reads plain lines and sidecars too. The log sources gain
`readStoredLines()`, which returns every line as readable, locked, not opening, or sealed by a newer
build, while `readText()` stays strict and throws `ArtifactLockedError` (with its reason),
`ArtifactCorruptError` or `SessionLogDecodeError` for a sealed line it cannot read, and a sealer's
own failure (a defect, not a damaged line) as it was thrown. `StoredLines` (whose `openText` is that
strict read), `StoredPayloads` and `splitStoredLines` are exported for hosts that build their own
append stores; a final fragment that is only the start of a sealed line's prefix is an append in
progress too. `IPromptHistoryBlock` gains an optional `unreadable: { locked, noKeys }`, and the
terminal's Ctrl+R search says how many prompts are sealed and whether an unlock would let it search
them. A project store reads its replay logs with its own sealing and reports a log it cannot read
as `locked`, `corrupt` or `unsupported` — a plain log whose payload file is missing or does not
match is now `corrupt` too, where `load` and `list` used to throw; `/validate-session` says when the
log is sealed instead of failing with an error.

`NodeToolResultSpillStore` and `createNodeToolResultSpillStore` take the same optional `sealing`. A
sealing spill store writes each result sealed and bound to its reference as `<token>.sealed`,
reads it back with the same sealer (keeping the result it opened last in memory while it is paged,
and forgetting it before its file is removed, even when the removal fails), and answers
`read-failed` for one that does not open; without it, results are written to `<token>.txt` as
before. In either mode, a result whose file is already gone when it expires or at shutdown now
counts as removed: it used to fail that cleanup with `cleanup-failed` every time, and with it every
later write.

What to do: nothing for existing calls, which keep writing plain records, lines, sidecars and
spilled results. A host that seals passes `{ sealing: { sealer } }` to every store it builds.
