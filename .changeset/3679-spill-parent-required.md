---
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-framework': patch
---

`NodeToolResultSpillStore` and `createNodeToolResultSpillStore` require `parentDirectory`, an existing
owner-only directory the host owns, and no longer fall back to a private directory under the shared
operating-system temporary directory. Spilled tool results are conversation content, so they never go
anywhere the host did not choose.

What to do: pass your own owner-only directory (the CLI passes one in its state root). The store's
directory in it is removed by `shutdown()`, when the process ends without reaching it, and, after a
kill, by `sweepStaleToolResultSpillDirectories(parent)`.
