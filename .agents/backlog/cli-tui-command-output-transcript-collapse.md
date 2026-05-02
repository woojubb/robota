# CLI TUI Command Output Transcript Collapse

## Priority

P1 — implement after the visual grammar audit.

## What

Render command execution output as a concise command row plus a bounded output preview, with an explicit transcript hint when output is longer than the visible preview.

## Why

Long command output can dominate the terminal and hide the important result. Modern coding assistant CLIs tend to show the command, a short result/output excerpt, and a way to inspect the full transcript. Robota already persists session data, so the TUI should summarize command output without losing the underlying record.

## Research Required

Research documentation and observed behavior for:

- Codex CLI command execution display and transcript access patterns.
- Claude Code focus view and tool-call summary behavior.
- Terminal UX patterns for collapsed command output and log previews.

Use documentation and product behavior observations only; do not copy source code from other projects.

## Scope

- Define a command output summary shape:
  - command line;
  - exit/status marker;
  - bounded stdout/stderr preview;
  - omitted line count;
  - transcript/session reference hint.
- Keep raw output persistence in session/logging layers.
- Keep truncation and transcript metadata structured, not embedded in assistant prose.
- Add tests for short output, long output, stderr, failed command, no output, and multiline output.

## Non-Goals

- Do not remove full command output from session persistence.
- Do not rely on model-generated summaries for command output.
- Do not implement interactive transcript browsing until the summary contract is stable.

## Acceptance Criteria

- [ ] Short command output renders inline without unnecessary decoration.
- [ ] Long output renders a bounded preview plus omitted-line transcript hint.
- [ ] Failed commands remain visually distinct from successful commands.
- [ ] The full transcript remains available from persisted session/log data.
- [ ] Formatting is tested independently from Ink component rendering.

## Promotion Path

1. Move to `.agents/tasks/CLI-BL-0XX-cli-tui-command-output-transcript-collapse.md`.
2. Implement after the visual grammar audit defines shared output labels and truncation copy.
