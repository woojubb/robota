---
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-subagent-runner': patch
---

A subagent now starts in the permission mode its parent is in at that moment. The runtime used to
hand the runner the mode it was built with, so after a switch to `plan` a subagent the model started
still ran in the earlier mode. `IInProcessSubagentRunnerDeps` gains the optional
`getParentPermissionMode`, which the session wires to its live mode; both the in-process and the
child-process runners read it at spawn and fall back to `permissionMode` when it is absent.
