---
"@robota-sdk/agent-framework": patch
---

On Windows, a working directory spelled with an 8.3 short name (`RUNNER~1`) is no longer refused as outside its trusted root. `createNodeFrameworkHost().canonicalizePath`, the Node file system's `realpathSync` and the workspace identity now resolve a directory the same way, and a session in a trusted project works in that spelling of its directory, so a directory reached by its short name (or, on any platform, through a symlink) reads `@path` references and project context from the right place instead of failing on the first prompt.
