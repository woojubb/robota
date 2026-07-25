---
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-transport-protocol': patch
'@robota-sdk/agent-transport-tui': patch
'@robota-sdk/agent-cli': patch
---

REMOTE-003 + REMOTE-006 (merged — net behavior; the interim deny-by-default gate never appeared in a
published version): commands now carry an invocation source. A `'remote'` value is added to the command
invocation source (SSOT relocated to `@robota-sdk/agent-interface-transport`, re-exported by
`agent-framework`) and an optional `source` is threaded into
`IInteractiveSession.executeCommand(name, args, source?)` (defaults to `'user'`, so all local callers are
unchanged). The shared `createWsHandler` tags transport-origin commands `'remote'`. Policy: local == remote
(owner principle) — pairing is the sole trust boundary, so a transport-origin command runs exactly as a
locally-typed one under the universal permission system (permission modes + PermissionEnforcer + the
ask/approval handler); `createDefaultRemoteCommandPolicy()` allows by default. The `IRemoteCommandPolicy`
seam remains as an OPTIONAL, user-configured restriction, and the genuinely-remote WebRTC path stays
pairing-gated.
