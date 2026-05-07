# TASK-BL-001 Logo Color Update

## Status

Completed.

## Priority

P3 - small UI polish in the playground package.

## Problem

`packages/agent-playground/src/components/ui/logo.tsx` used the theme `bg-primary` background for
the icon logo. The local backlog notes identified `bg-violet-400` as the intended brighter violet
target.

## Recommended Direction

Update only the `IconLogo` background class and add a focused component test that locks the new
style.

## Acceptance Criteria

- [x] `IconLogo` uses `bg-violet-400`.
- [x] The change is covered by a focused playground UI component test.
- [x] Existing logo sizing and text rendering behavior remains unchanged.

## Result

Updated `IconLogo` from `bg-primary` to `bg-violet-400` and added a component test for the icon
background class.

## Verification Plan

- `pnpm --filter @robota-sdk/agent-playground test -- logo`
- `pnpm --filter @robota-sdk/agent-playground typecheck`
- `pnpm --filter @robota-sdk/agent-playground lint`
- `pnpm --filter @robota-sdk/agent-playground build`
