---
'@robota-sdk/agent-sdk': patch
'@robota-sdk/agent-transport-http': patch
'@robota-sdk/agent-transport-ws': patch
'@robota-sdk/agent-transport-mcp': patch
---

refactor: transports consume InteractiveSession only — commandExecutor param removed

- Add InteractiveSession.listCommands() for transport tool discovery
- All transports use session.executeCommand() instead of separate commandExecutor
- Simplified factory signatures: only InteractiveSession required
