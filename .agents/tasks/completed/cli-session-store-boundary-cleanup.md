# CLI Session Store Boundary Cleanup

- **Status**: completed
- **Created**: 2026-05-05
- **Branch**: fix/cli-session-store-boundary
- **Scope**: packages/agent-cli, packages/agent-sdk, packages/agent-sessions, scripts/harness

## Objective

Remove the direct `agent-cli` dependency on `@robota-sdk/agent-sessions` while preserving project-local
session persistence, continue/resume/fork flows, and the saved-session picker.

## Plan

- [x] Confirm the current forbidden `agent-cli -> agent-sessions` imports and manifest dependency.
- [x] Update governing SPEC/rule docs before implementation.
- [x] Add regression tests and harness coverage for the forbidden edge.
- [x] Add SDK-owned session persistence facade and resumable-session summary helpers.
- [x] Migrate CLI construction, hooks, and picker to SDK-owned types/helpers.
- [x] Update `ARCHITECTURE-MAP.md` to remove the audit violation and show the new boundary.
- [x] Move backlog item to completed with acceptance criteria checked.
- [x] Run targeted package and harness verification.

## Progress

### 2026-05-05

- Merged PR #204, refreshed `develop`, and created `fix/cli-session-store-boundary`.
- Confirmed direct CLI imports from `@robota-sdk/agent-sessions` in `cli.ts`, `render.tsx`,
  `App.tsx`, `SessionPicker.tsx`, and `useInteractiveSession.ts`.
- Added SDK-owned project session store and resumable-session helpers.
- Removed the direct CLI `agent-sessions` package dependency and migrated resume/session picker flows
  to SDK facade types.
- Added command-layering harness checks for forbidden CLI imports and package dependencies.
- Updated SPEC/README/content docs and `packages/agent-cli/docs/ARCHITECTURE-MAP.md`.
- Verified affected packages and docs build.

## Decisions

- Use an SDK-owned session persistence facade instead of exposing `SessionStore` to the CLI.
- Keep the concrete JSON persistence implementation in `agent-sessions`; SDK owns the host-facing
  facade and resumable-session summaries.
- Add a harness check for the forbidden CLI dependency so the boundary does not regress.

## Blockers

- None.

## Result

Completed. The CLI now uses SDK-owned session persistence APIs for project-local stores, latest
session resolution, named/id resume, and picker summaries. The concrete sessions package remains
behind the SDK facade, and harness coverage now prevents the forbidden CLI dependency from
regressing.
