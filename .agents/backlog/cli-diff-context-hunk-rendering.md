# CLI Diff Context Hunk Rendering

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

- [ ] Edit tool summaries show changed lines plus surrounding context.
- [ ] Revert/deletion edits display removed and added lines with enough context to verify location.
- [ ] Large diffs are truncated predictably without hiding all changed lines.
- [ ] `renderMarkdown()` remains the only line-coloring implementation for diff bodies.
- [ ] Unit tests cover the hunk and truncation cases listed above.

## Promotion Path

1. Move to `.agents/tasks/CLI-BL-0XX-cli-diff-context-hunk-rendering.md`.
2. Complete diff-format research before implementation.
3. Update `agent-cli` SPEC first, then implement under TDD.
