---
'@robota-sdk/agent-interface-command': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-command-workflows': patch
'@robota-sdk/agent-mcp': minor
'@robota-sdk/agent-cli': minor
---

Built-in commands are offered to the model deliberately, each described for the model, and never
with a trust, credential or permission-widening action.

- `agent-interface-command` — `ICommand` gains `modelDescription?` (what the model is told, beside the
  short `/help` line), and `modelInvocable` on a subcommand entry now narrows what the model may run.
- `agent-framework` — `ISystemCommand` gains `modelDescription?`. Once any subcommand of a
  model-invocable command declares `modelInvocable`, the model may run only the bare command and the
  subcommands declared `true`; everything else, including an alias or an undeclared subcommand, is
  refused before the command runs. The model-facing descriptor lists only that subset.
- `agent-command` — `/context` (bare and `list`), `/cost` (the report, not `budget`) and `/mcp`
  (`status` only) are now model-invocable; `/memory approve` and `/memory reject` are now user-only;
  `/monitor` asks permission for the model's call because it starts a process. Every
  model-invocable command carries a model-facing description. The model's `/mcp status` shows only
  safe names, states and the command to suggest. New `mcpUserActionNotice`,
  `mcpUserActionCommand` and `mcpUnavailableServersNotice` build those fixed notices.
- `agent-command-workflows` — `/workflows` carries a model-facing description.
- `agent-mcp` — `createDiscoveredTool` accepts `authFailureNotice`: a call the server refuses for
  authentication returns that host text instead of the generic failure.
- `agent-cli` — an MCP server that did not start because the user must approve it, trust the
  workspace or sign in is named to the model at session start with the command to suggest, and a
  signed-in OAuth server that refuses a call tells the model to suggest `/mcp login <server>`.
