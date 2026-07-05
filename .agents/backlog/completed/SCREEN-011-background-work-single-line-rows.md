---
title: 'SCREEN-011: Background work rows wrap to two lines, orphaning the tree connector'
status: done
completed: 2026-07-02
created: 2026-06-30
priority: medium
urgency: soon
area: packages/agent-transport-tui
depends_on: []
---

# Background work rows wrap to two lines

Each "Background work" row prints its title + segments + a long prompt preview on one logical line,
which Ink wraps to a second terminal line. The continuation line has no `├`/`└`/`│` connector, so
the tree glyphs at the left lose all meaning:

```
 ├ ⟳ HARNESS-AND-CI agent · running · agent · general-purpose · "다음 백로그 파일들을 읽고 ...
 난이도, 의존성, 예상 작업량을 분석해줘. 파일들: /Users/.../HARNES        ← orphaned, no connector
```

## What

Render each background row as exactly **one terminal line**: set the row `<Text>` in
`BackgroundTaskPanel.tsx` to `wrap="truncate-end"` so the composed line (connector + marker + label

- segments + preview) is clipped to the panel width with an ellipsis instead of wrapping. The
  connector + status glyph then always sit at the start of their own single line. The long prompt
  preview is the part that gets truncated; the full text remains available via the detail drill-in
  (SCREEN-013). Keep `accessibleText` (full, untruncated) for the a11y path.

## Test Plan

- Component/snapshot test: a row with a very long preview renders a single line (no embedded newline)
  and still begins with the connector + marker.
- typecheck / lint / `pnpm --filter @robota-sdk/agent-transport-tui test` green.

## User Execution Test Scenarios

- Prereq: built CLI; a background agent whose prompt/preview is long (>1 terminal width).
- Steps: run `robota`, spawn a background agent with a long prompt, view the "Background work" panel
  in an 80-column terminal.
- Expected: every row is a single line beginning with `├`/`└` + the status glyph; long previews end
  with `…` rather than wrapping onto an unconnected second line.
- Evidence: Engineering — `background-task-panel.test.tsx` › "keeps a long-preview row on a single
  line (SCREEN-011)" passes: a row with a >1-width preview renders exactly one line that still begins
  with `└ ⟳`.
- Evidence (LIVE, agent-run 2026-07-02): real TUI in an 80-column PTY (real Anthropic provider); one
  background agent was given a >200-char prompt. Every panel row rendered as exactly one line —
  `├ ⟳ A1 agent · running · agent · general-purpose · Write one very long senten…` — truncated with
  `…` at the terminal edge; no row wrapped onto an unconnected second line. Scenario executed as
  written (long prompt, 80-col terminal).
