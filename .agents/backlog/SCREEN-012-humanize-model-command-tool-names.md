---
title: 'SCREEN-012: Tool display shows internal robota_command_* id instead of the command name'
status: in-progress
created: 2026-06-30
priority: medium
urgency: soon
area: packages/agent-transport-tui
depends_on: []
---

# Tool display shows the internal projected tool id

When the model invokes a slash command as a tool, the `Tools:` list shows the provider-safe
projected id rather than the natural command name:

```
 Tools:
   ⟳ robota_command_agent(parallel --wait "HARNESS-AND-CI:...")
```

`robota_command_agent` is the `MODEL_COMMAND_TOOL_PREFIX` (`robota_command_`) projection of the
`agent` command (`model-command-tool-projection.ts`), optionally suffixed with `_<8hex>` when the
name is too long to be provider-safe. The unique-id form is unnatural; we agreed to show the command
name.

## What

Humanize the displayed tool name in the TUI tool rows (`StreamingIndicator.tsx`, and the
`MessageList` tool summary). Add a small pure helper that, for a name starting with
`MODEL_COMMAND_TOOL_PREFIX`, strips the prefix (and a trailing `_<8 hex>` projection hash when
present) to recover the command name — e.g. `robota_command_agent` → `agent`. Non-command tool names
(`Shell`, `Read`, …) are returned unchanged. Import the prefix constant from `@robota-sdk/agent-framework`
so the value stays SSOT. Display becomes `⟳ agent(parallel --wait "…")`.

## Test Plan

- Unit test for the humanizer: `robota_command_agent` → `agent`; `robota_command_<body>_<hash>` →
  `<body>`; `Shell`/`Read` unchanged; empty/edge inputs safe.
- Component check: the tool row renders the humanized name.
- typecheck / lint / `pnpm --filter @robota-sdk/agent-transport-tui test` green.

## User Execution Test Scenarios

- Prereq: built CLI; a model turn that invokes a slash command as a tool (e.g. the model runs
  `/agent` / a parallel command).
- Steps: run `robota`, issue a prompt that makes the model call a command-tool, watch the `Tools:`
  list.
- Expected: the row reads `⟳ agent(...)` (the command name), not `robota_command_agent(...)`.
- Evidence: Engineering — `humanize-tool-name.test.ts` passes (`robota_command_agent` → `agent`,
  hash-suffixed → body, non-command names unchanged); `StreamingIndicator`/`MessageList` now call
  `humanizeToolName`. Live-TUI confirmation (model invokes a command-tool) pending a user run.
