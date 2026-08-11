# CLI TUI Output Visual Grammar Audit

- **Status**: completed
- **Created**: 2026-05-02
- **Branch**: docs/cli-tui-visual-grammar
- **Scope**: packages/agent-cli

## Priority

P0 — umbrella audit before broad TUI changes.

## What

Define a consistent visual grammar for Robota CLI output across plans, background jobs, tool execution, command output, streaming text, status indicators, and persisted history entries.

## Why

Recent CLI work added background jobs, agent orchestration, markdown diff rendering, command summaries, and status indicators incrementally. The output now works functionally, but it needs a coherent terminal presentation model so users can scan current activity, completed work, failures, and expandable details without reading noisy raw output.

## Initial Research Notes

- OpenAI Codex CLI is documented as an interactive terminal UI that can read, change, and run local code, with separate workflows for subagents, web search, code review, cloud tasks, and approval modes. Robota should treat TUI display as a first-class shell for structured runtime events, not as feature logic.
- Claude Code documents focus view as showing the last prompt, a one-line tool-call summary with edit diffstats, and the final response. This supports concise summaries with details available on demand.
- Claude Code status line documentation emphasizes configurable, color-coded, multi-line session/status information that can refresh on events and while background subagents change repository state.
- Claude Code supports configurable TUI renderers, including a fullscreen renderer. This supports separating visual renderer concerns from command/session semantics.

## Scope

- Audit all current CLI output surfaces:
  - `StreamingIndicator`
  - `MessageList`
  - `StatusBar`
  - background task panel
  - command/tool output summaries
  - markdown/diff rendering
  - permission and setup prompts
- Define a shared vocabulary for status icons, indentation, tree connectors, truncation labels, transcript hints, and activity labels.
- Define which layer owns each piece of data:
  - SDK/session/runtime owns structured events and state.
  - CLI TUI owns display grammar only.
  - Provider packages own provider wire-format adaptation only.
- Produce follow-up task breakdowns for individual implementation PRs.

## Non-Goals

- Do not add behavior instructions to prompts to force prettier output.
- Do not make TUI parse assistant prose as structured state.
- Do not couple TUI components to provider names, agent model names, or command-specific business logic.

## Acceptance Criteria

- [x] Audit document lists every current CLI output surface and its owner.
- [x] Visual grammar defines plan, tool, background, command, diff, status, warning, and error presentation.
- [x] Each later TUI implementation task references this grammar instead of inventing local formatting.
- [x] Tests are identified for both pure formatting modules and Ink render snapshots.

## Progress

### 2026-05-02

- Completed documentation-based research against Codex CLI, Claude Code status/subagent/focus surfaces, and GNU diff context behavior.
- Added the visual grammar owner contract to `packages/agent-cli/docs/SPEC.md`.
- Converted this backlog into a completed task so implementation follow-ups can reference the package SPEC.

## Decisions

- Treat the CLI TUI as a renderer for structured runtime/session events, not a parser of assistant prose.
- Use one-level tree rows, compact status markers, bounded previews, and explicit transcript/context hints as the baseline visual vocabulary.
- Keep provider/model-specific behavior outside generic TUI formatting.

## Blockers

- None.

## Result

The visual grammar is now documented in `packages/agent-cli/docs/SPEC.md`. Follow-up CLI TUI tasks must reuse this grammar instead of inventing local formatting.
