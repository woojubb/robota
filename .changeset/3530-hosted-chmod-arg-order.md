---
'@robota-sdk/agent-cli': patch
---

The E2B hosted executor passes `--` before the mode when it sets private permissions on restored conversation files and their directory, so the commands also run on BSD/macOS `chmod`.
