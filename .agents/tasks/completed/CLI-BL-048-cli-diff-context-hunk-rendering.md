# CLI Diff Context Hunk Rendering

- **Status**: completed
- **Created**: 2026-05-02
- **Branch**: feat/cli-diff-context-hunks
- **Scope**: packages/agent-cli, packages/agent-sdk

## Priority

P0 — edit visibility is a safety-critical CLI behavior.

## What

Upgrade Edit diff rendering from change-only blocks to context-aware hunks that show nearby unchanged lines, group related changes, and truncate large diffs by hunk rather than only by absolute line count.

## Why

Showing only changed lines makes edits hard to verify, especially when reverting or modifying multiple adjacent lines. Established diff formats show context around changes so users can understand where the edit occurred and how it relates to surrounding code.

## Initial Research Notes

- GNU diff documentation says users usually want nearby file parts around differing lines, and calls those nearby lines context.
- GNU diff context format defaults to three context lines when no count is specified, while `patch` typically needs at least two lines for robust application.
- Unified/context diff formats make code review easier than isolated add/remove lines because unchanged surrounding lines orient the reader.

## Research Required

Before implementation, compare:

- Git/GNU unified diff context defaults and hunk behavior.
- Codex and Claude Code user-facing edit/diff displays where documented or observable.
- Terminal readability constraints for compact inline diffs.

Use documentation and product behavior observations only; do not copy source code from other projects.

## Scope

- Generate context-aware `IDiffLine[]` for Edit summaries:
  - default surrounding context: propose 3 lines, confirm during implementation research;
  - include hunk headers or equivalent compact separators when useful;
  - merge nearby hunks when context overlaps;
  - truncate large diffs by hunk with an omitted-lines marker.
- Preserve markdown `diff` fenced rendering as the single colorization path.
- Keep file path and truncation metadata outside the markdown diff body.
- Add tests for:
  - addition;
  - deletion/revert;
  - replacement;
  - multi-line edit;
  - multiple separated hunks;
  - beginning/end of file;
  - large diff truncation.

## Non-Goals

- Do not implement a full Git diff engine unless research shows the current approach cannot safely support context hunks.
- Do not make assistant prose responsible for diff previews.
- Do not lose raw tool arguments or session records when truncating the visible diff.

## Acceptance Criteria

- [x] Edit tool summaries show changed lines plus surrounding context.
- [x] Revert/deletion edits display removed and added lines with enough context to verify location.
- [x] Large diffs are truncated predictably without hiding all changed lines.
- [x] `renderMarkdown()` remains the only line-coloring implementation for diff bodies.
- [x] Unit tests cover the hunk and truncation cases listed above.

## Progress

### 2026-05-02

- Researched GNU diff context/unified defaults and current Codex/Claude compact tool-summary behavior.
- Updated `agent-cli` SPEC with context-hunk rendering behavior.
- Added failing tests for three-line context, hunk headers, SDK-persisted context lines, and hunk-aware truncation.
- Implemented context-aware edit diff generation and hunk-aware markdown summary rendering.

## Decisions

- Use three context lines by default, matching common unified diff behavior.
- Keep diff colorization through fenced `diff` markdown only.
- Keep file path and truncation metadata outside the fenced diff body.
- Let SDK-persisted tool summaries include context when the edited file can be read; CLI legacy extraction follows the same display behavior.

## Blockers

- None.

## Result

Edit tool summaries now include a compact hunk header, surrounding context lines where available, and deterministic hunk-aware truncation metadata.
