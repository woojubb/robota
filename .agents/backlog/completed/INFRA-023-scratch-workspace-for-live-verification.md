---
title: 'INFRA-023: scratch/ workspace — the one home for live-verification scripts, with a guard against temp files in packages/'
status: done
completed: 2026-07-04
created: 2026-07-03
priority: medium
urgency: now
area: scratch/, scripts/harness, .agents/rules
depends_on: []
---

# Live-verification script home

Owner question (2026-07-03): "왜 라이브러리 속에 이상한 넘버링이 되어 있는 파일을 만들었는가?"
During the goal loop, disposable User-Execution scripts (`err-001-proxy.mjs`,
`core-016-user-execution.ts`, …) were repeatedly placed INSIDE library package roots because pnpm's
strict, script-location-relative ESM resolution cannot resolve `@robota-sdk/*` imports from the
scratchpad or `/tmp`. Deletion discipline kept them out of every commit, but discipline is not a
mechanism — one `git add -A` accident away, and the working tree the owner watches shows unknown
numbered files inside libraries.

## What (approved recommendation)

1. **`scratch/` workspace package** at repo root (NOT under `packages/` — dev tooling tier, not a
   library; Library Neutrality Rule untouched): COMMITTED skeleton (`package.json` `private: true`
   name `robota-scratch`, `workspace:*` deps on core/provider/tools/session/framework/testing,
   `tsconfig.json`, `README.md`, `.gitignore`) with **`src/` contents gitignored** — scripts run
   but can never be committed. Committing the skeleton with pinned deps keeps `pnpm-lock.yaml`
   importers stable (`--frozen-lockfile` CI safe); a fully-ignored directory would fork the
   lockfile per machine.
2. Workspace registration (`pnpm-workspace.yaml` + root `package.json` `workspaces`, aligned per
   the workspace-drift scan) and harness-scope exclusion (same mechanism as examples in
   `scripts/harness/shared.mjs`).
3. **Guard scan** (mechanism over prose): temp-pattern files (`*-user-execution.*`, `*-proxy.mjs`,
   `*-mode.txt`) under `packages/**` or `apps/**` fail the scan.
4. One-line convention in `.agents/rules/backlog-execution.md`: User-Execution scripts live in
   `scratch/src/`.

## Test Plan

- `pnpm install` lockfile-clean; a sample script in `scratch/src/` importing `@robota-sdk/agent-core`
  runs via `tsx --conditions=source`; `git status` stays clean with scripts present; guard scan
  fails on a planted `packages/agent-core/x-user-execution.ts` and passes clean; full
  `pnpm harness:scan` green.

## User Execution Test Scenarios

- Prereq: repo as-is.
- Steps: write a script in `scratch/src/` that constructs a Robota with a real provider key and
  runs one turn; check `git status`; plant a temp-named file in a package root and run the scan.
- Expected: script resolves deps and runs; git stays clean; the scan blocks the planted file.
- Evidence: **PASS (live, 2026-07-04).** Implemented as approved: `scratch/` root workspace
  package (committed skeleton — `private: true` `robota-scratch`, `workspace:*` deps on
  core/provider/tools/session/framework/testing + zod, tsconfig with `customConditions:
['source']`, README, `.gitignore src/*` with a kept `.gitkeep`); registered in
  pnpm-workspace.yaml + root `workspaces` (drift scan green) and excluded from harness scopes
  alongside examples (`shared.mjs`). Guard mechanized: new `temp-script-placement` scan (44
  scans total) fails on `*-user-execution.*` / `*-proxy.mjs` / `*-mode.txt` under `packages/**`
  or `apps/**` (+2 unit tests in the harness suite, 223 green; verify-change wired). Convention
  recorded once in `.agents/rules/backlog-execution.md` § User Execution rule. User Execution
  (scenario as written): a `scratch/src/` script constructing a Robota with the REAL Anthropic
  key resolved all `@robota-sdk/*` imports and answered `SCRATCH-OK`; `git status` showed zero
  scratch/src entries with the script present; a planted
  <!-- evidence-superseded: deliberately transient probe file planted to prove the scan fires, removed in the same run; the durable guard is scripts/harness/__tests__/check-temp-script-placement.test.mjs -->
  `packages/agent-core/x-099-user-execution.ts` failed the scan (exit 1) and full
  `pnpm harness:scan` is green after removal. Lockfile stable (committed skeleton deps —
  `pnpm install` no-churn).
