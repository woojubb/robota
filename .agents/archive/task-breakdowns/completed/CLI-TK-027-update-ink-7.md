# CLI-TK-027 Update Ink 7

- **Status**: completed
- **Created**: 2026-04-30
- **Branch**: chore/update-tui-library
- **Scope**: packages/agent-cli

## Objective

Update the CLI TUI library dependency after checking the latest Ink release notes, verify compatibility with Robota's TUI input flows, and document recommended follow-up uses of new Ink capabilities.

## Plan

- [x] Identify current TUI dependencies and latest available versions.
- [x] Review upstream Ink 7 release notes.
- [x] Update the relevant dependency versions and lockfile.
- [x] Fix compile/test regressions caused by Ink 7.
- [x] Run targeted agent-cli verification.
- [x] Record impact and recommendations.

## Prior Art Research

Ink is the current TUI framework used by `@robota-sdk/agent-cli`.

- Current Robota version: `ink@6.8.0`
- Latest npm version checked on 2026-04-30: `ink@7.0.1`
- Companion packages already current: `ink-select-input@6.2.0`, `ink-spinner@5.0.0`, `ink-text-input@6.0.0`, `ink-testing-library@4.0.0`
- Ink 7.0.0 requires Node.js 22 and React 19.2+, which matches Robota CLI's Node 22 workspace and `react@19.2.4`.
- Ink 7.0.0 changes key semantics: physical Backspace is now `key.backspace` instead of `key.delete`; plain Escape no longer sets `key.meta`.
- Ink 7.0.0 adds `usePaste`, `useWindowSize`, `useBoxMetrics`, `useAnimation`, `render({ alternateScreen })`, `render({ interactive })`, `Text wrap="hard"`, and new Box layout props.
- Ink 7.0.1 fixes `useApp().exit` typing and Escape handling with disabled focus.

## Progress

### 2026-04-30

- Created task after opening PR #101 for the previous background task spec work.
- Confirmed `packages/agent-cli` owns the Ink TUI dependency.
- Confirmed latest Ink release from npm and upstream GitHub release notes.
- Updated `ink` to `^7.0.1` and regenerated `pnpm-lock.yaml` via `pnpm install`.
- Updated the CLI package engine/docs to Node.js 22+ because Ink 7 requires Node.js 22.
- Found Ink 7 regression risk around toggling the App-level ESC `useInput` handler with overlays. Changed App to keep the listener mounted and guard overlay state inside the handler.

## Decisions

- Only update the core TUI library (`ink`) in this task unless verification shows a required peer or companion package change.
- Do not manually edit `pnpm-lock.yaml`; regenerate it with `pnpm install`.
- Keep the App-level ESC abort listener mounted. Overlay state should be checked inside the handler to preserve abort behavior after permission/plugin/session overlays close.

## Impact

- Node.js support for `@robota-sdk/agent-cli` moves from Node.js 20+ to Node.js 22+ because Ink 7 declares `engines.node >=22`.
- Current key handling already supports Ink 7's Backspace semantics because prompt flows check `key.backspace || key.delete`.
- Current ESC handling uses `key.escape`, so the Ink 7 `key.meta` change does not require production logic changes.
- Tests that used fixed wall-clock delays around TUI input became sensitive under full-suite concurrency; prompt queue tests now use deterministic completion control and assertion polling.

## Recommendations

- Consider replacing Robota's manual bracketed paste handling with Ink 7's `usePaste` in a focused follow-up. This is promising for `CjkTextInput` and paste-template behavior, but should be done behind characterization tests because Robota has custom Korean/CJK cursor handling.
- Consider replacing `useStdout().stdout.columns` width reads with Ink 7's `useWindowSize` for terminal resize reactivity.
- Consider `render({ alternateScreen: true })` only as an opt-in mode. It would make the TUI feel more like a full-screen terminal app, but it changes scrollback expectations and should not be the default without UX review.
- Consider `useAnimation` for `WaveText` or streaming indicators if animation timing needs cleanup, but keep the current rendering debounce in `TuiStateManager`.

## Test Plan

- Run targeted ESC overlay regression tests to prove the App-level abort handler still works after a permission prompt closes and remains ignored while the prompt is active.
- Run prompt queue tests to prove queued prompt replacement, ESC queue clearing, and Backspace queue clearing remain deterministic under Ink 7.
- Run full `@robota-sdk/agent-cli` build, test, lint, and typecheck via `pnpm harness:verify -- --scope packages/agent-cli --base-ref origin/develop`.
- Run repository scan gates for spec coverage, test-plan coverage, dependency direction, publish safety, file-size warnings, dist freshness, and docs structure.

## Blockers

- None.

## Result

Updated `@robota-sdk/agent-cli` from Ink 6.8.0 to Ink 7.0.1, regenerated the lockfile with `pnpm install`, aligned the CLI package engine/docs to Node.js 22+, and adjusted App-level ESC handling to remain mounted while guarding overlays in the handler. Verified package build, 399 agent-cli tests, lint, typecheck, targeted harness verification, `harness:scan`, and `git diff --check`.
