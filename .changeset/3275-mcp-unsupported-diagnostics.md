---
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-command': patch
---

Report unsupported MCP transports at startup and reload instead of silently skipping them,
and distinguish plugin MCP declaration inspection from a runtime connection.
