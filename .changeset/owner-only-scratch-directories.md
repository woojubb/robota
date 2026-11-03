---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-cli': patch
---

The CLI keeps spilled tool results and the `/editor` buffer in owner-only, per-process directories of its state root instead of the shared operating-system temporary directory. They are removed when the run ends, including on a hangup, interrupt or termination, and the next start removes those a killed run left behind.

`NodeToolResultSpillStore` and `createNodeToolResultSpillStore` take an optional `parentDirectory`: an existing owner-only directory the host owns, used as it is. A store there records its owner, is removed when the process ends without `shutdown()`, and can be cleaned up after a kill with the new `sweepStaleToolResultSpillDirectories(parent)`. Omitting `parentDirectory` keeps the previous location under the operating-system temporary directory and is deprecated. The process-scoped directory helpers behind this are exported from `@robota-sdk/agent-core/node`.
