# CLI TUI Command Output Transcript Collapse

Status: completed
Created: 2026-05-02
Branch: feat/cli-command-transcript-collapse
Scope: packages/agent-cli, packages/agent-sdk

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

- [x] Short command output renders inline without unnecessary decoration.
- [x] Long output renders a bounded preview plus omitted-line transcript hint.
- [x] Failed commands remain visually distinct from successful commands.
- [x] The full transcript remains available from persisted session/log data.
- [x] Formatting is tested independently from Ink component rendering.

## Promotion Path

1. Move to `.agents/tasks/CLI-BL-0XX-cli-tui-command-output-transcript-collapse.md`.
2. Implement after the visual grammar audit defines shared output labels and truncation copy.

## Research Result

- Codex-style terminal output favors a compact command row followed by a bounded transcript preview and an explicit hint when additional output is omitted.
- Claude-style tool displays keep tool execution separate from model prose, so Robota should derive command previews from structured tool result data rather than asking the model to summarize command output.
- Terminal log preview patterns work best when the raw transcript remains persisted and the visible TUI output only presents a bounded projection.

## Implementation Notes

- Added `formatCommandOutputSummary` as a pure CLI formatter for command-like tools.
- Extended SDK `IToolState` and `tool-summary` metadata with `toolResultData` so the CLI can render persisted command previews after completion and resume.
- Kept output collapse scoped to command tools (`Bash`, `BackgroundProcess`) to avoid rendering large non-command tool payloads such as file reads.

## Verification

- `pnpm --filter @robota-sdk/agent-cli test -- src/ui/__tests__/command-output-summary.test.ts src/ui/__tests__/message-list-rendering.test.tsx`
- `pnpm --filter @robota-sdk/agent-sdk test -- src/interactive/__tests__/interactive-session-streaming.test.ts`
