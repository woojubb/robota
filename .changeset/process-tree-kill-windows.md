---
"@robota-sdk/agent-process": patch
---

`killProcessTree` now ends the whole process tree at once on Windows. Before, it ended only the direct child first, so a shell that exited left the program it started running with the shell's output pipes open, and a caller waiting for the child to close waited forever.
