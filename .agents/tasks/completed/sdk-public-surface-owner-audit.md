# SDK Public Surface Owner Audit

- **Status**: completed
- **Created**: 2026-05-05
- **Branch**: refactor/sdk-public-surface-owner-audit
- **Scope**: packages/agent-sdk, packages/agent-cli/docs, scripts/harness

## Objective

Classify the SDK public export surface by ownership and remove or document exports that hide lower
package owners. Keep intentional SDK facades explicit so beta consumers do not inherit accidental
compatibility contracts.

## Plan

- [x] Generate the current SDK export inventory.
- [x] Compare exports against SDK, runtime, core, sessions, tools, and CLI specs.
- [x] Classify exports as SDK-owned API, SDK facade, compatibility re-export, or wrong-owner export.
- [x] Remove wrong-owner exports where monorepo consumers can import the owning package directly.
- [x] Document intentional SDK facades and compatibility exports.
- [x] Add or update mechanical checks for broad pass-through export drift.
- [x] Move the backlog item to completed and run affected verification.

## Progress

### 2026-05-05

- Started from `develop` on `refactor/sdk-public-surface-owner-audit`.
- Removed lower-owner top-level SDK pass-through exports and moved CLI imports to owner packages or local adapter types.
- Added `harness:scan:sdk-public-surface` with fixture coverage and root harness wiring.
- Documented public surface ownership in SDK docs and marked `CLI-AUDIT-007` resolved in the architecture map.

## Decisions

- Keep runtime background/subagent lifecycle re-exports as explicit SDK facade barrels because CLI and transports consume runtime contracts through SDK composition.
- Remove top-level SDK pass-throughs for general `agent-core`, `agent-tools`, and `agent-sessions` APIs during beta; consumers must import these from owner packages.

## Test Plan

- `rg -n "export \\* from '@robota-sdk|export \\* from" packages/agent-sdk/src`
- `pnpm --filter @robota-sdk/agent-sdk test`
- `pnpm --filter @robota-sdk/agent-sdk typecheck`
- `pnpm --filter @robota-sdk/agent-cli test`
- `pnpm harness:scan:deps`
- `pnpm harness:scan:commands`
- `pnpm docs:build`
- `pnpm build`
- `git diff --check`

## Blockers

- (none)

## Result

SDK top-level exports now expose SDK-owned APIs and documented SDK facades. Lower-owner utility
exports are owner-direct, and `pnpm harness:scan:sdk-public-surface` prevents broad pass-through
drift.
