# CLI Remove Duplicate Thinking Status

## Status

Completed.

## Created

2026-05-06

## Priority

P2 - small TUI cleanup that removes redundant execution state.

## Problem

`packages/agent-cli/src/ui/StatusBar.tsx` now shows foreground execution state in the primary
status scan path through `StatusActivityText`. The same `isThinking` state is also rendered by
`StatusRight` as a lower-right `thinking...` label next to the message count. This duplicates the
same state in two places and makes the status area noisier than necessary.

## Scope

- `packages/agent-cli/src/ui/StatusBar.tsx`
- `packages/agent-cli/src/ui/__tests__/status-bar.test.tsx`
- `packages/agent-cli/docs/SPEC.md`
- `packages/agent-cli/docs/ARCHITECTURE-MAP.md` only if it still documents or illustrates the
  lower-right thinking indicator

## Constraints

- Keep `StatusActivityText` and `formatStatusActivity()` as the SSOT for visible primary activity
  state.
- Do not change SDK thinking events or execution lifecycle semantics.
- Do not remove `StreamingIndicator` fallback behavior in this task unless tests prove it is part of
  the same duplicate status surface.
- Keep the message count visible on the right side.

## Recommended Direction

Remove the lower-right `thinking...` rendering from `StatusRight` and make `StatusRight` responsible
only for passive metadata such as `msgs: N`. Update tests and CLI SPEC text/examples so `Thinking`
appears only in the primary activity segment.

## Acceptance Criteria

- [x] `StatusBar` renders `Thinking` in the primary activity segment when `isThinking` is true.
- [x] `StatusBar` no longer renders lower-right `thinking...` next to `msgs: N`.
- [x] Message count rendering remains unchanged.
- [x] Tests assert that only one visible status-bar thinking label is present.
- [x] CLI SPEC no longer describes the lower-right thinking indicator as active behavior.

## Result

Removed the right-side `thinking...` status text from `StatusRight`. The status bar now presents
foreground model waiting only through the primary activity segment while keeping `msgs: N` visible
on the right.

## Verification Plan

- `pnpm --filter @robota-sdk/agent-cli test -- status-bar`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
