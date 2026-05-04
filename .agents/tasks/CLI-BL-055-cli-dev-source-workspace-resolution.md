# CLI-BL-055 CLI Dev Source Workspace Resolution Research

Status: deferred
Created: 2026-05-04
Branch: unassigned
Scope: root package scripts, packages/agent-cli, workspace package exports/dev resolution

## Priority

P3 - optional dev-loop research only. The current behavior is standard pnpm workspace plus Node package `exports` behavior, so this should not be treated as a correctness bug unless stale `dist` becomes a proven recurring development problem.

## What

Research whether `pnpm run cli:dev` should keep using the current package-name import resolution contract or add an explicit source-first dev mode for internal `@robota-sdk/*` workspace packages.

## Why

The repository is a pnpm monorepo. pnpm links workspace packages into `node_modules`, but it does not rewrite package entrypoints or bypass Node package resolution. When a source file imports a workspace package by package name, for example `@robota-sdk/agent-sdk`, Node/tsx still reads that package's `package.json` and follows its `exports`/`main` fields. If those fields point to `dist/node/index.js`, then the linked workspace package is selected but its `dist` entrypoint is still used. This is normal package-manager/runtime behavior, not a pnpm bug.

A source-first dev mode may still be useful if the team wants `cli:dev` to observe internal package source edits without rebuilding. That would be an explicit repository policy choice rather than the default pnpm behavior.

Potential source-first dev contract:

- source changes should be visible immediately in `pnpm run cli:dev`;
- `cli:dev` should not require `pnpm build` or `build:deps`;
- local runtime behavior should not depend on whether `dist` happens to be fresh.

## Current Evidence

- Root `package.json` runs `cli:dev` as `tsx packages/agent-cli/src/bin.ts`.
- Internal packages publish `exports` and `main` entries that point at `dist/node/index.js`.
- Workspace dependencies are linked package directories. This means local packages are used instead of registry copies, but package-name imports still respect those packages' export maps unless an explicit dev resolution strategy overrides them.

## Recommendation

Keep the current `dist`-backed package export contract unless stale `dist` creates repeated development failures. If that happens, add an explicit source-first dev resolution contract for internal workspace packages while preserving production/publish `dist` exports.

Recommended implementation path:

1. Add a dev-only conditional export such as `source` or `development` to internal workspace packages that maps `.` to `./src/index.ts`.
2. Run `cli:dev` with the matching Node/tsx condition, for example `tsx --conditions=source packages/agent-cli/src/bin.ts`.
3. Keep existing `types`, `node`, and `default` conditions pointing at `dist` for package consumers and npm publishing.
4. Add a regression check that fails if `pnpm run cli:dev` requires `dist` files from internal workspace packages.

This is preferable to relying on ad hoc tsconfig path aliasing because package export conditions keep the dev/runtime resolution contract near each package's public export map and avoid a second hidden module graph.

## Scope

- Audit all internal packages imported directly or indirectly by `packages/agent-cli/src/bin.ts`.
- Decide the canonical dev condition name and document it.
- Update package export maps or root dev loader configuration so internal workspace imports resolve to source for `cli:dev`.
- Ensure the strategy works with ESM, `tsx`, and pnpm workspace links.
- Ensure production `node`, `default`, `bin`, and npm publish behavior still resolves to `dist`.
- Add a mechanical test or harness check proving `cli:dev` does not need prebuilt internal `dist` artifacts.

## Non-Goals

- Do not make published package consumers load TypeScript source.
- Do not remove `dist` from published package export maps.
- Do not introduce a dev-only resolution path that differs from package boundaries so much that it hides dependency direction violations.
- Do not solve all app dev scripts unless they share the same workspace source-resolution mechanism naturally.

## Acceptance Criteria If Implemented

- [ ] `pnpm run cli:dev` can start from a clean checkout after `pnpm install` without running `pnpm build`.
- [ ] Changing source in an internal package used by the CLI is reflected by the next `pnpm run cli:dev` run without rebuilding that package.
- [ ] If internal package `dist` directories are removed, `pnpm run cli:dev` still resolves workspace dependencies successfully.
- [ ] Published package export maps still point normal `node`/`default` consumers at `dist`.
- [ ] A regression test or harness check covers source-first CLI dev resolution.
- [ ] The chosen dev condition/loader strategy is documented in the root dev workflow docs or relevant rules.

## Test Plan

1. Run `pnpm install`.
2. Remove or temporarily hide `dist` for a small set of internal packages imported by the CLI, including `agent-sdk` and at least one command package.
3. Run `pnpm run cli:dev` with a non-network smoke path or a test harness that verifies startup/module resolution without requiring a provider API call.
4. Modify a source-only marker in an internal package and verify the dev command observes it without rebuilding.
5. Run `pnpm build` to ensure production `dist` output and types still build correctly.

## Decisions Needed

- None now. User decision on 2026-05-04: if this is standard pnpm/Node workspace behavior, keep the current behavior.
- If revisited, recommended condition name: `source`, because it describes the resolution target and avoids overloading environment words like `development`.

## Blockers

- Need a provider-free CLI startup smoke path or harness entrypoint if the current CLI immediately enters provider setup or provider validation.
