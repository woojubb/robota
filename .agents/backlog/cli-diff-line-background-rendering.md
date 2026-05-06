# CLI Diff Line Background Rendering

## Status

Backlog.

## Created

2026-05-06

## Priority

P2 - diff readability and TUI polish.

## Problem

The CLI currently renders markdown fenced `diff` blocks with foreground color only: added lines are
green, removed lines are red, hunk headers are cyan, and metadata is dim. This makes additions and
deletions distinguishable, but changed lines do not stand out enough in dense edit diffs.

Adding background colors would improve scanability, but the current diff body is rendered as a plain
terminal string with a fixed left indent. If background color is applied only around the text content,
the left/right whitespace remains uncolored and creates visible gutters. The desired behavior is that
the addition/removal background fills the entire rendered diff row, including padding, rather than
only the characters in the changed line.

## Current Code Confirmation

- `packages/agent-cli/src/ui/render-markdown.ts` owns markdown `diff` fenced block rendering.
- `colorizeDiffLine()` currently applies ANSI foreground colors only.
- `renderDiffCodeBlock()` prepends `CODE_BLOCK_INDENT` and joins diff lines as a terminal string.
- `ToolDiffBlock` renders tool edit diffs by delegating the markdown body to `renderMarkdown()`.
- `packages/agent-cli/docs/SPEC.md` already requires tool summaries to use the shared markdown diff
  body path, so this should not become a second bespoke coloring policy.

## Scope

- `packages/agent-cli/src/ui/render-markdown.ts`
- `packages/agent-cli/src/ui/__tests__/render-markdown.test.ts`
- `packages/agent-cli/src/ui/ToolDiffBlock.tsx` only if row-width information must be supplied by the
  Ink layer
- `packages/agent-cli/docs/SPEC.md`
- Message/tool rendering tests if snapshots or assertions depend on diff output escape sequences

## Constraints

- Keep markdown fenced `diff` rendering as the SSOT for assistant diffs and tool edit diffs.
- Preserve readable output when color is disabled.
- Do not make added/removed line meaning depend only on background color; keep the `+` and `-`
  prefixes and foreground colors.
- Avoid hardcoded terminal widths that create overflow or wrapping regressions.
- Do not color `content/api-reference/**`; those docs are generated.

## Recommended Direction

Render diff lines with both foreground and background ANSI styles when color is enabled. To make the
background fill the whole row, the renderer should pad each rendered diff row to the available code
block width before applying the background style. If `renderMarkdown()` cannot know the available
width reliably, introduce an optional width setting passed from the Ink rendering layer and fall back
to content-width coloring when no width is available.

Recommended color policy:

- additions: green foreground plus dark green background
- removals: red foreground plus dark red background
- hunk headers: cyan foreground, no strong background unless testing shows it improves readability
- context/metadata: unchanged or dim, no added/deleted background

## Acceptance Criteria

- [ ] Added diff lines use both foreground and background color when color is enabled.
- [ ] Removed diff lines use both foreground and background color when color is enabled.
- [ ] Added/removed backgrounds cover each rendered row including indentation and right-side padding.
- [ ] Color-disabled rendering remains plain readable diff text with no ANSI color sequences.
- [ ] Assistant markdown diffs and Edit tool diff summaries use the same diff background policy.
- [ ] Tests cover row padding/background behavior and no-color fallback.
- [ ] CLI SPEC documents foreground-plus-background diff rendering and row-fill behavior.

## Verification Plan

- `pnpm --filter @robota-sdk/agent-cli test -- render-markdown message-list-rendering streaming-indicator`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-cli lint`
