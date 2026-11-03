---
'@robota-sdk/agent-mcp': patch
---

Stop reporting a standard JSON Schema `$schema` dialect declaration as an unenforceable schema subtree, so servers such as Exa no longer print a schema warning on every start; any other dialect is still reported.
