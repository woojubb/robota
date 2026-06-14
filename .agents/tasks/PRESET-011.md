# PRESET-011: 런타임 active-preset 상태 seam — Task Breakdown

Spec: `.agents/spec-docs/done/PRESET-011-runtime-active-preset-state.md`

## Plan

- [x] TC-01: `Session({activePresetId: 'autonomous-builder'})` → `getActivePresetId()` returns it
- [x] TC-02: no option → `getActivePresetId()` returns `'default'`
- [x] TC-03: `setActivePresetId('careful-reviewer')` mutates id; `getPermissionMode()` unchanged (pure state)
- [x] TC-04: `ICommandSessionRuntime` declares `getActivePresetId?`/`setActivePresetId?` (typecheck pass)
- [x] TC-05: cli selected id threaded into session options `activePresetId` (renderApp + runPrintMode paths)
- [x] TC-06: framework/session/transport/cli build + `pnpm typecheck` exit 0
- [x] TC-07: `pnpm --filter @robota-sdk/agent-session test` exit 0 (no regressions)
- [x] Add optional contract methods to `ICommandSessionRuntime`
- [x] Add `activePresetId` to `ISessionOptions` + `SessionBase` accessors + `Session` init
- [x] Thread selected id through cli → renderApp/runPrintMode → createSession → Session

## Test Plan

Runtime active-preset STATE seam on the session: `ICommandSessionRuntime` optional
`getActivePresetId`/`setActivePresetId`, `SessionBase` accessors mirroring the `permissionMode`
pattern, `Session` initializing from `ISessionOptions.activePresetId` (default `'default'`), and the
cli threading the startup-selected preset id through every intermediate options interface
(renderApp/runPrintMode → InteractiveSession → createSession → Session). Verified by vitest unit
assertions (init-from-option, default, pure-state mutate with permission-mode unchanged), monorepo
typecheck (contract declaration), and build/session-test smoke. Pure state tracking — NO option
re-application (PRESET-012/013/014 own that).
