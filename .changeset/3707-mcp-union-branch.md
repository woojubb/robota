---
'@robota-sdk/agent-mcp': patch
---

Narrowing replaces an inexpressible `anyOf` branch with the accepts-anything node instead of leaving `{}`. A `$ref` branch, as in Parallel's `web_decisions`, used to fail tool registration, so every turn failed while that server was connected.
