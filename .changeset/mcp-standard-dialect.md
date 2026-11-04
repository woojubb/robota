---
'@robota-sdk/agent-mcp': patch
---

Narrow a third-party MCP tool schema to exactly the keywords the universal subset declares. A constraint the subset cannot check (such as `multipleOf`) is now dropped and reported instead of being carried along, which made the session record refuse to load ("Session record cannot be updated: corrupt") once a server such as Exa was connected; annotations such as `title` are dropped quietly, and a standard JSON Schema `$schema` dialect is no longer reported as unenforceable.
