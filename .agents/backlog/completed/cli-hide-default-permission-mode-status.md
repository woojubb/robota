# CLI Hide Default Permission Mode In Status Bar

## Status

Completed.

## Created

2026-05-06

## Priority

P2 - TUI clarity cleanup.

## Problem

`packages/agent-cli/src/ui/StatusBar.tsx` renders `Mode: <permissionMode>` in the primary status
line. In practice this looks like a model performance mode or provider capability mode, but the
value is actually the SDK permission mode. This is confusing because users cannot use it to select a
provider-level "fast" or "smart" model behavior, and provider/model capabilities differ too much for
the CLI to present a generic mode label honestly.

The status bar already has several high-value fields: activity, session/profile/model identity, git
branch, context, and message count. Rendering `Mode: default` permanently adds visual noise because
`default` is the normal baseline. Non-default permission modes are operationally important and should
remain visible.

## Code Confirmation

- `StatusBar.tsx` renders `Mode:` through `ModeText({ permissionMode })`.
- `App.tsx` passes `session.getPermissionMode()` into `SessionStatusBar`.
- `agent-command-mode` implements `/mode` by reading/writing SDK permission mode.
- `TPermissionMode` is `plan | default | acceptEdits | bypassPermissions`; it is not a provider
  speed tier, model quality tier, or generic fast/smart mode.

## Scope

- `packages/agent-cli/src/ui/StatusBar.tsx`
- `packages/agent-cli/src/ui/SessionStatusBar.tsx`
- `packages/agent-cli/src/ui/App.tsx` and render prop plumbing only if `permissionMode` becomes
  unused by the status surface
- `packages/agent-cli/src/ui/__tests__/status-bar.test.tsx`
- `packages/agent-cli/docs/SPEC.md`
- `packages/agent-cli/docs/ARCHITECTURE-MAP.md` if diagrams/examples describe unconditional `Mode:`

## Constraints

- Do not remove the SDK permission-mode runtime contract in this task.
- Do not remove `/mode` or `--permission-mode`.
- Keep permission enforcement behavior unchanged.
- Keep provider/model/profile identity visible in the status bar.
- Keep activity state as the first primary scan-path item.
- Keep non-default permission modes visible because they affect tool approval behavior.

## Recommended Direction

Render permission mode conditionally:

- `default`: hide the mode segment.
- `plan`: show `Mode: plan`.
- `acceptEdits`: show `Mode: acceptEdits`.
- `bypassPermissions`: show `Mode: bypassPermissions`.

Treat `default` as the baseline state and non-default modes as explicit operational overrides.

## Acceptance Criteria

- [x] The status bar does not render `Mode: default`.
- [x] The status bar still renders `Mode: plan`, `Mode: acceptEdits`, and
      `Mode: bypassPermissions`.
- [x] Activity, provider profile/model, git branch, context usage, and message count remain visible.
- [x] Status-bar tests cover both hidden default mode and visible non-default modes.
- [x] CLI SPEC status examples describe permission mode as conditional status metadata.
- [x] Permission-mode CLI flags, commands, and SDK behavior remain unchanged.

## Result

Changed the status bar permission mode segment to render only for non-default modes. `default` is
treated as the baseline and hidden; `plan`, `acceptEdits`, and `bypassPermissions` remain visible.

## Verification Plan

- `pnpm --filter @robota-sdk/agent-cli test -- status-bar`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
