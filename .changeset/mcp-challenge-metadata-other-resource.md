---
'@robota-sdk/agent-mcp': patch
---

A 401 whose challenge links protected-resource metadata for another resource no longer breaks the sign-in: discovery sets the linked document aside, takes nothing from it, and uses the endpoint's own path-specific document when that names the endpoint exactly. A first-party service that links a per-tool document naming a parent path therefore keeps working after the first refused token, instead of failing with a resource mismatch until the next sign-in.
