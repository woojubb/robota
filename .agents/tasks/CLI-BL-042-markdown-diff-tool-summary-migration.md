# CLI-BL-042 Markdown Diff Tool Summary Migration

- **Status**: backlog
- **Created**: 2026-05-02
- **Scope**: packages/agent-cli
- **Related**: .agents/tasks/completed/CLI-BL-029-markdown-diff-rendering.md

## Objective

Migrate Robota CLI tool-summary diff presentation toward the Markdown fenced `diff` rendering path introduced by `CLI-BL-029`, while preserving the tool-summary requirements that still need structured data: file path, line numbers, truncation, permission context, and streaming state.

## Problem

`CLI-BL-029` completed assistant-response rendering for Markdown `diff` fenced code blocks. However, `Edit` tool summaries still use `DiffBlock` and `IDiffLine[]` through `tool-call-extractor`, `MessageList`, and `StreamingIndicator`. This keeps two diff rendering paths in the CLI:

- assistant-authored diff suggestions use Markdown;
- tool-generated edit previews use a bespoke React component and structured diff lines.

The follow-up should determine how much of the tool-summary path can become Markdown diff text without losing metadata or permissions UX.

## Research Plan

Before implementation, verify documentation and public behavior from comparable coding assistants and Markdown/terminal renderers:

- How coding CLIs present edit previews and tool-result diffs inside Markdown-like transcripts.
- Whether terminal Markdown renderers can preserve readable diff output while surrounding metadata remains structured.
- How permission prompts, truncation notices, and file-path headers are represented when the diff body is Markdown.

Do not copy source code from other projects; use product docs and observable behavior only.

## Recommended Direction

Keep metadata structured, but make the diff body Markdown-owned:

- Introduce a `ToolDiffSummary` view model with structured metadata plus a Markdown `diff` fenced body.
- Convert existing `IDiffLine[]` output into a unified diff-like fenced block for rendering through `renderMarkdown()`.
- Keep file path, truncation count, and permission labels outside the fenced block as structured UI.
- Retire `DiffBlock` only after `MessageList` and `StreamingIndicator` tests prove equivalent output for completed and in-flight tool summaries.

## Plan

- [ ] Document the target tool-summary diff contract in `packages/agent-cli/docs/SPEC.md`.
- [ ] Add RED tests for converting `IDiffLine[]` into a Markdown `diff` fenced block with file headers and line context.
- [ ] Add component tests proving `MessageList` and `StreamingIndicator` render tool diffs through the Markdown path.
- [ ] Preserve permission prompt and truncation metadata as structured UI outside the Markdown diff body.
- [ ] Remove or narrow `DiffBlock` only when no production path still depends on bespoke diff rendering.
- [ ] Run targeted `agent-cli` tests, typecheck, build, lint, and harness scan.

## Test Plan

- Given an `Edit` tool summary with remove/add/context lines, when the summary view model is built, then the diff body is a Markdown `diff` fenced block.
- Given a tool summary has a file path, when rendered, then the file path remains visible outside the diff code block.
- Given a compact diff is truncated, when rendered, then the truncation notice remains visible and is not embedded as diff source text.
- Given color output is disabled, when a tool-summary diff renders through Markdown, then added and removed lines remain readable as plain text.
- Given `StreamingIndicator` receives an active Edit tool, when it renders in-flight diff data, then it uses the same diff-body renderer as completed message history.
- Given non-Edit tool summaries render, when this migration lands, then they do not gain empty diff blocks or unrelated formatting changes.

## Acceptance Criteria

- Tool-summary diffs and assistant Markdown diffs share the same diff body rendering path.
- Structured tool metadata remains available for file path, truncation, permissions, and streaming status.
- `DiffBlock` is either removed or documented as a narrow compatibility component with no duplicated diff-coloring policy.
- Existing assistant Markdown diff rendering from `CLI-BL-029` does not regress.

## Blockers

None.

## Result

Pending.
