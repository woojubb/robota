---
'@robota-sdk/agent-framework': major
---

Framework query, runtime, interactive, and headless session creation now pass through one validated `SessionRecipe` constructor seam. Standard interactive options require provider and working directory; wrapping a host-owned session remains an explicit recipe mode, and test doubles use the package's `/testing` entry.
