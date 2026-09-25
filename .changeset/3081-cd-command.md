---
'@robota-sdk/agent-interface-command': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-ui-terminal': minor
'@robota-sdk/agent-cli': minor
---

`/cd <directory>` continues the conversation in another directory.

- **A move is a new session in the target directory.** In the TUI, robota saves a copy of the
  conversation where the target's session store will find it, ends the current run through its
  normal end-of-life flow, and starts again in the target directory resuming that copy. The target's
  settings, trust decision, tools, skills and `AGENTS.md` apply, exactly as if robota had been
  launched there. The process boundary makes the move atomic, so no tool call can straddle it.
- **The system prompt is kept as recorded**, so a provider's prompt cache survives. One appended
  `<workspace-move>` message tells the model the new directory, and which project instructions now
  apply.
- **Refused** while a turn is running or a background task is still running, for a missing directory
  or the current one, and for a target a `Cd(...)` deny rule names.
- **Access never widens:** a restricted session stays restricted after a move, and a trusted session
  takes the target's own trust decision.
- New contracts: the `workspace-move` host action, `ICommandWorkspaceAdapter` /
  `IWorkspaceMoveRequest`, `InteractiveSession.moveWorkspace`, and the `workspaceMovedFrom` session
  option. The CLI's `--moved-from` and `--restricted-workspace` flags are internal.
