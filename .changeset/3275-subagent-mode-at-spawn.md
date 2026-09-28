---
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-subagent-runner': patch
'@robota-sdk/agent-command-workflows': patch
---

A subagent and a fork-context skill now start in the permission mode their parent is in at that
moment. The runtime used to hand them the mode it was built with, so after a switch to `plan` a
subagent the model started, or a skill it ran in a fork, still ran in the earlier mode and could
edit. `IInProcessSubagentRunnerDeps` gains the optional `getParentPermissionMode`, which the session
wires to its live mode; the in-process and child-process runners read it at spawn and fall back to
`permissionMode` when it is absent.

In plan mode the model can no longer run `/workflows create` or `/workflows build`: both save to
the project, and `create` also runs the workflow. The user can still run them by hand.
