---
'@robota-sdk/agent-command': patch
---

In `plan` mode the model can no longer save project memory with `/memory add`. The command is auto-approved, so it ran in plan mode while `Write` and `Edit` were denied there. Reading memory, and adding it by hand, still work in plan mode.
