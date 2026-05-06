# CLI Remove Message Count From Status Bar

## Status

Backlog.

## Created

2026-05-06

## Priority

P2 - TUI status bar cleanup.

## Problem

`packages/agent-cli/src/ui/StatusBar.tsx` renders a right-side `msgs: N` segment through
`StatusRight`. After moving active state into the primary status scan path and hiding baseline
metadata such as `Mode: default`, the message count is low-value passive metadata in the always
visible status bar. It consumes horizontal space and keeps the status bar visually noisy without
helping the main interaction flow.

## Current Code Confirmation

- `StatusRight({ messageCount })` renders `<Text dimColor>msgs: {messageCount}</Text>`.
- `StatusBar` still requires `messageCount` in its props and passes it to `StatusRight`.
- `SessionStatusBar` and `App` still pass message count into the status bar.
- `packages/agent-cli/docs/SPEC.md` documents `msgs` as a status bar field and shows it in the
  example.

## Scope

- `packages/agent-cli/src/ui/StatusBar.tsx`
- `packages/agent-cli/src/ui/SessionStatusBar.tsx`
- `packages/agent-cli/src/ui/App.tsx` and render prop plumbing if `messageCount` becomes unused by
  the status surface
- `packages/agent-cli/src/ui/__tests__/status-bar.test.tsx`
- `packages/agent-cli/docs/SPEC.md`
- `packages/agent-cli/README.md`, `content/guide/cli.md`, and `content/examples/interactive-mode.md`
  if they still mention message count in status bar examples

## Constraints

- Do not remove message tracking from SDK/session state.
- Do not change conversation history behavior.
- Do not remove message count from other commands or debug surfaces unless they are explicitly part
  of this status bar display path.
- Keep activity, non-default permission mode, provider/model/profile identity, git branch, and
  context usage visible.

## Recommended Direction

Remove the visible `msgs: N` segment from the status bar and delete the now-empty `StatusRight`
component if it has no remaining responsibility. If the status bar no longer needs a right-side
section, simplify the layout rather than keeping an empty spacer solely for symmetry.

## Acceptance Criteria

- [ ] The status bar no longer renders `msgs: N`.
- [ ] `messageCount` is removed from status bar props and upstream TUI plumbing if no longer used by
      the status surface.
- [ ] Status-bar tests assert that message count is not rendered.
- [ ] CLI SPEC and user-facing docs no longer list `msgs` as a status bar field.
- [ ] Activity, conditional permission mode, provider/model/profile, git branch, and context usage
      still render correctly.

## Verification Plan

- `pnpm --filter @robota-sdk/agent-cli test -- status-bar`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-cli lint`
