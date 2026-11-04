---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-ui-terminal': minor
---

Move the last two Node-reading exports off the framework's main entry, and give the session's replay-validation read to the host.

- `resolveGitBranchFromNodeHost` is now on `@robota-sdk/agent-framework/node`, not the main entry. It reads a checkout's `.git` directory with `node:fs`; the terminal UI imports it from `/node`.
- `validateWorkspaceSessionReplayLog` is now on `@robota-sdk/agent-framework/node`. The session reaches it through a new host member, `validateSessionReplayLog(projectAccess, sessionId)`, which `createNodeFrameworkHost` fills. A host that supplies none leaves the session unable to read its log: `validateCurrentSessionReplayLog()` throws an error that names the member, and `/validate-session` reports it. On Node it behaves as before: the log is read as plain, and a sealed one is reported as sealed.
