---
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-transport-protocol': patch
'@robota-sdk/agent-transport-tui': patch
'@robota-sdk/agent-cli': patch
---

REMOTE-003 Stage B1: gate remote-origin commands (security hardening). Add a `'remote'` value to the command
invocation source (SSOT relocated to `@robota-sdk/agent-interface-transport`, re-exported by `agent-framework`)
and thread an optional `source` into `IInteractiveSession.executeCommand(name, args, source?)` (defaults to
`'user'`, so all local callers are unchanged). The shared `createWsHandler` now tags transport-origin commands
`'remote'`, and the session applies a **deny-by-default remote-command policy**: a remote command runs only if it
is read-only or explicitly allowlisted — otherwise it is denied with an explicit error and never executed
(no silent no-op). Local (`'user'`) and model (`'model'`) command paths are unaffected. This closes the
previously-ungated command path on the existing WebSocket transport and is the security precondition for the
WebRTC remote-control enable path (no user-facing enable path ships in B1).
