---
'@robota-sdk/agent-tools': patch
---

Bound host Read input and formatted output bytes before a workflow can materialize an oversized file or result. Oversized reads now fail the tool call instead of returning content.
