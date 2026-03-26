---
'@robota-sdk/agent-sdk': minor
'@robota-sdk/agent-transport-http': minor
'@robota-sdk/agent-transport-ws': minor
'@robota-sdk/agent-transport-mcp': minor
'@robota-sdk/agent-transport-headless': minor
'@robota-sdk/agent-cli': minor
---

feat: ITransportAdapter unified interface + headless transport + CLI adapter pattern

- ITransportAdapter interface in agent-sdk (name, attach, start, stop)
- InteractiveSession.attachTransport(transport) method
- createHttpTransport, createWsTransport, createMcpTransport, createHeadlessTransport factories
- CLI print mode uses adapter pattern: session.attachTransport(transport)
- agent-transport-headless: text/json/stream-json output, stdin pipe, exit codes
- --output-format, --system-prompt, --append-system-prompt CLI flags
