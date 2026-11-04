---
'@robota-sdk/agent-framework': minor
---

Start making the framework platform-neutral: thirty-eight leaf modules no longer import `node:path`, `node:crypto`, `node:util`, `node:fs` types or `Buffer`, and use the `@robota-sdk/agent-core` helpers instead. Persisted ids, digests and comparison results are unchanged. The package stays Node-only until the rest of the split lands.

- A working directory that is not absolute is refused where a project prompt or context reference is resolved ("The session working directory must be absolute"), and a plugin path that is not absolute is refused with `PluginPathContainmentError`. Both used to be resolved against the process directory.
- A root-relative path that is spelled as a root on either platform (`\x`, `C:\x`) is refused on every platform; a POSIX host used to let a Windows spelling through.
- `listFrameworkProjectContributionPaths` reads a working directory written with `\` as the same ancestors as one written with `/`.
- Labels built by joining relative segments (a memory topic `path`, an agent `definedIn`, a `system:` reference id) are spelled with `/` on Windows too.
