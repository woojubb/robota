# TUI Remove Activity Prefix from Status Bar

## Status

Backlog.

## Priority

P3 - small visual cleanup.

## Problem

`StatusActivityText` in `packages/agent-cli/src/ui/StatusBar.tsx` renders activity as
`Activity: Idle`, `Activity: Thinking`, and similar labels. The `Activity:` prefix consumes
horizontal space and adds visual noise in an already dense status bar.

## Scope

- `packages/agent-cli/src/ui/StatusBar.tsx`
- `packages/agent-cli/src/ui/__tests__/status-bar.test.tsx`
- `packages/agent-cli/docs/SPEC.md`
- `packages/agent-cli/docs/ARCHITECTURE-MAP.md` only if the status bar example changes there

## Constraints

- This is a presentation-only change.
- `status-activity.ts` should remain unchanged unless tests prove the formatted activity string
  itself owns the prefix.
- No provider, model, session, or SDK behavior should change.

## Recommended Direction

Remove the visible `Activity:` label from the status bar renderer and render only the activity text
such as `Idle`, `Thinking`, `Tools xN`, `Background xN`, or `Queued`.

## Acceptance Criteria

- [ ] The status bar renders activity state without the `Activity:` prefix.
- [ ] Existing activity state text and colors remain unchanged.
- [ ] Narrow-width status bar behavior does not regress.
- [ ] Tests no longer assert the prefix.
- [ ] CLI SPEC examples are updated if they still show the prefix.

## Verification Plan

- `pnpm --filter @robota-sdk/agent-cli test -- status-bar`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
