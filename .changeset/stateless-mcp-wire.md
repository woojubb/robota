---
'@robota-sdk/agent-mcp': patch
---

Add an explicit stateless MCP request surface over admitted HTTP and stdio transports, preserving legacy negotiation by default. Validate per-request/version, discovery and cache metadata, preserve private page hints, separate retained catalogs by carrier generation, and close uncertain timed-out execution without replay.
