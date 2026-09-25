---
'@robota-sdk/agent-interface-command': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-command-workflows': patch
'@robota-sdk/agent-mcp': minor
'@robota-sdk/agent-cli': minor
---

Built-in commands are offered to the model deliberately, each described for the model, and never
with a trust, credential or permission-widening action.

- `agent-interface-command` — `ICommand` gains `modelDescription?` (what the model is told, beside the
  short `/help` line), and `modelInvocable` on a subcommand entry now narrows what the model may run.
- `agent-framework` — `ISystemCommand` gains `modelDescription?` and `modelRequiresPermission?`.
  Once any subcommand of a model-invocable command declares `modelInvocable`, the model may run only
  the bare command and the subcommands declared `true`; everything else, including an alias or an
  undeclared subcommand, is refused before the command runs. The model-facing descriptor lists only
  that subset. A model-requested monitor's command is now decided by the shell tool's gate (its
  Bash/Shell rules, the mode and the prompt) and a refusal rejects with the new
  `MonitorCommandRefusedError`. The `scriptedSession` test harness accepts `permissions` patterns.
- `agent-session` — `Session.checkToolPermission(toolName, toolArgs)` decides a call exactly as the
  session's gate decides that tool call.
- `agent-command` — `/context` (bare and `list`), `/cost` (the report, not `budget`) and `/mcp`
  (`status` only, without a prompt) are now model-invocable; `/memory approve` and `/memory reject`
  are now user-only; the model's `/monitor` is decided by the shell gate rather than by consent to
  the command's name. Every model-invocable command carries a model-facing description. The model's
  `/mcp status` shows only safe names, states and the command to suggest, and a caller that does not
  identify itself gets that view. `/context list` accounts only for turns still in context. New
  `mcpUserActionNotice`, `mcpUserActionCommand` and `mcpUnavailableServersNotice` build the fixed
  notices.
- `agent-command-workflows` — `/workflows` carries a model-facing description.
- `agent-mcp` — `createDiscoveredTool` accepts `authFailureNotice`: a call the server refuses for
  authentication returns that host text instead of the generic failure.
- `agent-cli` — an MCP server that did not start because the user must approve it, trust the
  workspace or sign in is named to the model at the start of an interactive session with the
  command to suggest, and a
  signed-in OAuth server that refuses a call tells the model to suggest `/mcp login <server>` — or, in print and serve runs, the terminal
  `robota mcp login <server>`.
