# CLI Diff Foreground Contrast

## Status

Completed.

## Priority

P1 - markdown diff readability affects code review and edit approval in the TUI.

## Problem

The CLI recently added full-row background colors for fenced `diff` markdown blocks. The row-fill
behavior was correct, but the foreground colors had weak contrast against the added/removed line
backgrounds in some terminals.

Current added/removed rows combined dark backgrounds with standard ANSI red/green foregrounds. On
terminals with muted palettes, `31` red on dark red and `32` green on dark green could make changed
content harder to read than the previous foreground-only rendering.

## Research

- W3C WCAG contrast guidance treats foreground/background contrast as the readable signal for text,
  not just hue. It recommends at least 4.5:1 contrast for normal text and 3:1 for larger text.
- Robota already uses 256-color ANSI background escapes for diff rows, so using 256-color light
  foreground escapes keeps the policy deterministic instead of depending on terminal-specific
  standard ANSI red/green palettes.

Sources:

- <https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum>

## Recommended Direction

Keep the full-row background behavior, but increase foreground contrast for changed diff rows.

Implemented color policy:

- removed rows: dark red background plus light red foreground
- added rows: dark green background plus light green foreground
- hunk headers and metadata remain unchanged
- color-disabled rendering remains plain text with no ANSI escape sequences

## Acceptance Criteria

- [x] Added diff rows use a higher-contrast foreground color over the existing green background.
- [x] Removed diff rows use a higher-contrast foreground color over the existing red background.
- [x] Added/removed backgrounds still cover the full rendered row including indentation and
      right-side padding.
- [x] Color-disabled diff rendering remains unchanged and contains no ANSI color sequences.
- [x] Assistant markdown diffs and Edit tool diff summaries use the same updated contrast policy.
- [x] Tests assert the new contrast color constants and preserve row-fill coverage.
- [x] CLI SPEC documents the higher-contrast foreground policy.

## Result

`render-markdown.ts` now uses 256-color light red/light green foreground escapes for changed diff
rows while preserving the existing dark red/dark green full-row backgrounds. The markdown renderer
test coverage and CLI SPEC were updated to match the shared policy used by assistant markdown diffs
and edit tool summaries.

## Verification Plan

- `pnpm --filter @robota-sdk/agent-cli test -- render-markdown`
- `pnpm --filter @robota-sdk/agent-cli test -- message-list-rendering streaming-indicator`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-cli lint`
