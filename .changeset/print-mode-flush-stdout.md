---
'@robota-sdk/agent-cli': patch
---

Print mode (`-p`, `--goal`) waits for stdout and stderr to flush before exiting, so a result larger than the pipe buffer is no longer cut off when stdout is a pipe on macOS (for example `-p /help --output-format json`).
