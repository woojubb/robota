---
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-ui-terminal': minor
'@robota-sdk/agent-command': minor
---

Every store that keeps conversation content now states how it seals (`TArtifactSealing`, from
`@robota-sdk/agent-core`), and has no plain default: a store left plain beside sealed ones would
write plaintext next to them. `{ sealing: { sealer } }`
seals with an `IArtifactSealer` (bound to the record, line or file it belongs to), and
`{ sealing: 'plain' }` writes plain JSON, lines and files as before. A store that seals reads plain
content too and seals what it rewrites; a store that does not seal meets a sealed file as `locked`.

What breaks, and what to do: the `sealing` option is required (omitting it is a compile error and a
`TypeError` at run time) wherever a store is built or read, so pass `{ sealing: 'plain' }` to keep
what you have.

- `@robota-sdk/agent-session`: `NodeSessionStore(baseDir, { sealing, ownedRoot? })`, where `ownedRoot`
  moves from a positional argument into the options; `NodePromptHistoryFile`, `NodeSessionLogSink`,
  `NodeSessionLogSource`, `NodeExternalPayloadSource` (with an optional `ownerId`) and
  `NodeToolResultSpillStore` take it in their options.
- `@robota-sdk/agent-framework`: `createUserSessionStore(dir, { sealing })`,
  `createNodeHostSessionStore(dir, { sealing, ownedRoot? })` (same move of `ownedRoot`),
  `createProjectSessionStore(sessions, logs, { sealing })`, `WorkspaceProjectSessionStore`,
  `createUserPromptHistoryFile`, `WorkspaceSessionLogSink`, `WorkspaceSessionLogSource` and
  `createNodeToolResultSpillStore`. `IWorkspaceProjectStateStorage` gains `replaceBytes`, which the
  framework's storage implements; the project session store replaces a record whole through it.

A sealing append store writes each append as one sealed line and each log sidecar sealed under a
random name. The log sources gain `readStoredLines()`, which returns every line as readable, locked,
not opening, or sealed by a newer build, while `readText()` stays strict and throws
`ArtifactLockedError`, `ArtifactCorruptError` or `SessionLogDecodeError`. `StoredLines`,
`StoredPayloads` and `splitStoredLines` are exported for hosts that build their own append stores.
`IPromptHistoryBlock` gains an optional `unreadable: { locked, noKeys }`, and the terminal's Ctrl+R
search says how many prompts are sealed and whether an unlock would let it search them. A project
store reads its replay logs with its own sealing and reports a log it cannot read as `locked`,
`corrupt` or `unsupported`; a plain log whose payload file is missing or does not match is now
`corrupt` too, where `load` and `list` used to throw, and `/validate-session` says when the log is
sealed instead of failing with an error.

A sealing spill store writes each result sealed and bound to its reference as `<token>.sealed` and
answers `read-failed` for one that does not open. In either mode a result whose file is already gone
when it expires or at shutdown now counts as removed, where that cleanup used to fail with
`cleanup-failed` every time, and with it every later write.
