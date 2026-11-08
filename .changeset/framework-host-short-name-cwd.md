---
"@robota-sdk/agent-framework": patch
---

On Windows, a working directory spelled with an 8.3 short name (`RUNNER~1`) is no longer refused as outside its trusted root. `createNodeFrameworkHost().canonicalizePath` and the workspace identity now resolve a directory the same way, so the directory a user reaches by its short name is the one the repository trust was granted for.
