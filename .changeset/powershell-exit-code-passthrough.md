---
"@robota-sdk/agent-core": patch
---

On Windows, a hook, shell tool or background command that ends with a native program's exit code now reports that exit code. PowerShell's `-Command` used to turn every failed native command into exit code 1, so a hook that exited 2 to block a tool was read as an ordinary failure and did not block.
