---
'@robota-sdk/agent-framework': patch
---

Bind interactive prompt, fork-skill, and foreground-command execution cleanup to an opaque
controller-owned claim so stale cleanup cannot release another active operation or drain its queued
input.
