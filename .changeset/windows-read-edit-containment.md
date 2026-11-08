---
"@robota-sdk/agent-tools": patch
---

On Windows, Read and Edit now refuse a file that was swapped for a link to somewhere outside the working directory between the containment check and the open, as they already did on Linux and macOS.
