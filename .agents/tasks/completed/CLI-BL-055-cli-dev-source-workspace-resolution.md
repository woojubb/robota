# CLI-BL-055 CLI Dev Source Workspace Resolution Research

Status: completed
Created: 2026-05-04
Branch: feat/cli-selected-backlogs
Scope: root package scripts, packages/agent-cli, workspace package exports/dev resolution

## Priority

P3 - dev-loop source resolution improvement. The current behavior was standard pnpm workspace plus Node package `exports` behavior, but source-first `cli:dev` is now explicit repository policy for the CLI dependency closure.

## What

Ensure `pnpm run cli:dev` runs against internal package source without requiring a prior package build, while preserving published `dist` exports for normal package consumers.

## Why

The repository is a pnpm monorepo. pnpm links workspace packages into `node_modules`, but it does not rewrite package entrypoints or bypass Node package resolution. When a source file imports a workspace package by package name, for example `@robota-sdk/agent-sdk`, Node/tsx still reads that package's `package.json` and follows its `exports`/`main` fields. If those fields point to `dist/node/index.js`, then the linked workspace package is selected but its `dist` entrypoint is still used. This is normal package-manager/runtime behavior, not a pnpm bug.

A source-first dev mode may still be useful if the team wants `cli:dev` to observe internal package source edits without rebuilding. That would be an explicit repository policy choice rather than the default pnpm behavior.

Potential source-first dev contract:

- source changes should be visible immediately in `pnpm run cli:dev`;
- `cli:dev` should not require `pnpm build` or `build:deps`;
- local runtime behavior should not depend on whether `dist` happens to be fresh.

## Current Evidence

- Root `package.json` now runs `cli:dev` as `tsx --conditions=source packages/agent-cli/src/bin.ts`.
- Internal packages in the CLI dependency closure publish a dev-only `exports["."].source` condition that points at `./src/index.ts`.
- Internal packages preserve `node` and `default` conditions pointing at `dist/node/index.js`.
- Workspace dependencies are linked package directories. This means local packages are used instead of registry copies, but package-name imports still respect those packages' export maps unless an explicit dev resolution strategy overrides them.

## Recommendation

Use an explicit source-first dev resolution contract for `cli:dev` while preserving production/publish `dist` exports.

Implemented path:

1. Add a dev-only conditional export named `source` to internal workspace packages that maps `.` to `./src/index.ts`.
2. Run `cli:dev` with the matching Node/tsx condition: `tsx --conditions=source packages/agent-cli/src/bin.ts`.
3. Keep existing `types`, `node`, and `default` conditions pointing at `dist` for package consumers and npm publishing.
4. Add regression checks that fail if the root script or package export maps lose the source-first CLI dev contract.

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

- [x] `pnpm run cli:dev` can start from a clean checkout after `pnpm install` without running `pnpm build`.
- [x] Changing source in an internal package used by the CLI is reflected by the next `pnpm run cli:dev` run without rebuilding that package.
- [x] If internal package `dist` directories are removed, `pnpm run cli:dev` still resolves workspace dependencies successfully.
- [x] Published package export maps still point normal `node`/`default` consumers at `dist`.
- [x] A regression test or harness check covers source-first CLI dev resolution.
- [x] The chosen dev condition/loader strategy is documented in the root dev workflow docs or relevant rules.

## Test Plan

1. Run `pnpm cli:dev --version` to verify provider-free startup/module resolution.
2. Temporarily hide `dist` for internal packages imported by the CLI, including `agent-sdk`, `agent-core`, command packages, provider packages, runtime, tools, sessions, and transport.
3. Run `pnpm cli:dev --version` while `dist` is hidden to prove source conditions are sufficient.
4. Run the harness source-resolution regression test.
5. Run targeted package builds and typechecks to ensure production `dist` output and types still build correctly.

## Decisions Needed

- Chosen condition name: `source`, because it describes the resolution target and avoids overloading environment words like `development`.
- Production and publish behavior remain `dist`-backed through existing `node` and `default` export conditions.

## Blockers

- (none)

## Result

Completed. `pnpm cli:dev` now uses the `source` export condition, the CLI dependency closure exposes `./src/index.ts` through that condition, harness coverage locks the contract, and source startup was verified with relevant internal `dist` directories temporarily hidden.
