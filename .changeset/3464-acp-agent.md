---
'@robota-sdk/agent-transport-acp': minor
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-transport': minor
'@robota-sdk/agent-transport-mcp': patch
---

`robota acp` runs the agent as an Agent Client Protocol (v1) agent over stdio, so an editor that launches it (Zed, JetBrains and other ACP clients) can create a session, send prompts, see streamed replies and tool calls, approve or reject permission requests, and cancel a turn. Workspace trust, permission rules and the sandbox behave as in the terminal: the editor answers prompts and widens nothing. A folder that is not trusted yet is refused at `session/new` with the `trust` command to run, a working directory other than the one the agent was started in and any editor-supplied MCP servers or extra roots are refused, and a prompt that starts with `/` runs that command.

New package `@robota-sdk/agent-transport-acp` provides `createAcpTransport`, the ACP `ITransportAdapter` the command uses.

`@robota-sdk/agent-transport/node` gains `attachStdioCarrier`, the process-input bridge and close observation a stdio protocol carrier shares. `agent-transport-mcp` now uses it for its stdio carrier; its behavior is unchanged.
