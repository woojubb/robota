---
status: in-progress
type: INFRA
tags: [harness, ci]
---

# INFRA-037: Parallelize the harness scan runner + de-serialize CI quality from build

## Problem

The CI `quality` job is the slow gate (observed 4m8s on PR #1060, and it recurs on every PR). Two
independent causes, both measurable in the code:

1. **The scan runner is fully sequential.** `scripts/harness/run-all-scans.mjs` `runScans()` is a
   `for (const scan of scans) { await scan.run() }` loop, and `spawnScan` spawns one node subprocess per
   scan with `stdio: 'inherit'`. So all ~48 scans run **one at a time**, many doing full-repo AST/file
   walks — the wall-clock is the _sum_ of 48 subprocess runs, not the max.
2. **`quality` needlessly waits on `build`.** In `.github/workflows/ci.yml` the `quality` job declares
   `needs: build`, so it cannot start until `build` finishes (~3 min), then downloads the package-dist
   artifact. But its two heaviest steps — `pnpm harness:scan --skip dist` and `pnpm harness:test` — do
   **not** consume `dist` (scan explicitly skips it; the harness `__tests__` are pure). Only the
   dist-dependent `harness:verify` step needs `build`'s output. The build-wait is pure serialization.

Lesson (to institutionalize): a CI job must not `needs:` a slow upstream job for steps that do not
consume that job's output, and independent check suites should run concurrently, not sequentially.

## Architecture Review

### Affected Scope

- `scripts/harness/run-all-scans.mjs` — `spawnScan` captures output (pipe) instead of streaming
  (`inherit`); `runScans` runs scans with **bounded concurrency** and prints each scan's captured output
  **only on failure** (passes stay a one-line `✓`), preserving the exact summary lines
  (`✓ <name>` / `all N scans passed` / `N of M scans failed`) so downstream parsing + the harness tests
  still hold.
- `.github/workflows/ci.yml` — split the dist-independent checks (`harness:scan --skip dist`,
  `harness:test`) into a new `scans` job with **no `needs: build`** (runs in parallel with `build`);
  `quality` keeps `needs: build` for only the dist-dependent `harness:verify`.
- Local: parallelizing `runScans` speeds a direct `pnpm harness:scan` and `harness:verify:release`
  (`build:deps && harness:scan`). It does NOT speed the pre-push gate — `harness:pre-push` runs
  `harness:verify`, and `verify-change.mjs` runs individual `harness:scan:*` commands, neither of which
  goes through `runScans`.

### Alternatives Considered

1. **Leave sequential; only split the CI job.** Halves the build-wait but leaves the 48-subprocess
   serialization — the dominant cost. Rejected as half the fix.
2. **Parallelize the runner + strategically branch the CI job (chosen).** Bounded-concurrency scan
   execution (cap = `availableParallelism()-1`) with captured, failure-only output, AND move the
   dist-independent suites off `needs: build`. Attacks both causes; the runner change also speeds a direct
   local `harness:scan` (not the pre-push gate — see Affected Scope).
3. **Shard scans across multiple CI matrix jobs.** More runners, more parallelism, but multiplies
   install/setup overhead and complicates the required-check set. Deferred — the in-process concurrency
   cap captures most of the win without matrix complexity.

### Decision

**Alternative 2.** Parallelize `runScans` (bounded concurrency, captured failure-only output, identical
summary contract) and de-serialize CI by running the dist-independent scan/test suites in a `scans` job
parallel with `build`. No scan is dropped or weakened; the full 48-scan suite + harness `__tests__` remain
required gates — they just run concurrently and off the build critical path.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — scripts/harness/run-all-scans.mjs, .github/workflows/ci.yml
- [x] Sibling scan 완료 — `runScans`/`spawnScan` are the sole runner; callers = run-all-scans + harness test
- [x] 대안 최소 2개 검토 완료 — 3개 (job-split-only / runner+job / matrix-shard)
- [x] 결정 근거 문서화 완료 — attack both causes; preserve summary contract + required-gate coverage

## Solution

1. `spawnScan(command)` → `stdio: ['ignore', 'pipe', 'pipe']`; accumulate stdout+stderr; resolve
   `{ code, output }`.
2. `runScans(scans, write, concurrency = max(1, availableParallelism()-1))` → a bounded worker pool draws
   scans off a shared index, stores `{ name, code, output }` in original order; after all finish, print
   the captured `output` of each **failed** scan (for debuggability), then the unchanged `✓/✗ <name>`
   lines + `all N scans passed` / `N of M scans failed`. Return the aggregate exit code. Determinism: the
   summary + exit code are order-independent; only interleaving of live streaming is removed.
3. `.github/workflows/ci.yml`: new `scans` job (checkout + pnpm + install + **`harness:scan --skip dist
--skip build-contracts`** + `harness:test`, **no `needs`** — runs in parallel with `build`). Shape it
   like `build`/`quality` to avoid a stuck-pending required check: **no job-level `if`**, a "Skip duplicate
   scans for main PR" no-op step gated on `github.base_ref == 'main'`, and step-level
   `if: github.base_ref != 'main'` on the real steps (so the required check always resolves). `quality`
   keeps `needs: build` + dist restore and runs `harness:verify` **AND the `build-contracts` scan** (after
   dist restore) — because `check-build-output-contracts.mjs` reads `packages/*/dist` and silently no-ops
   without it (it is the ONLY non-skipped scan that reads build output; verified). This carve-out keeps
   identical coverage while moving 47 of 48 scans + the full harness test suite off the build critical path.
4. **Required-check registration (branch protection — the load-bearing safeguard, NOT the diff).** Add
   `scans` to the required status checks on `develop`/`main` protection so a red `scans` blocks merge; a
   green `quality` must not let a red `scans` through (the INFRA-026 gate-blind-spot). This is a one-time
   manual repo-settings change — a **release-blocking checklist item**, flagged because it lives outside
   the PR diff and is the step most likely to be forgotten.

## Affected Files

- `scripts/harness/run-all-scans.mjs` (parallel runner + captured output)
- `.github/workflows/ci.yml` (new `scans` job; `quality` runs verify + build-contracts after dist restore)
- `scripts/harness/__tests__/run-all-scans.test.mjs` (the execution-**order** assertion at ~line 24 breaks under parallelism — rewrite to a concurrency + summary/exit-contract assertion)
- Branch-protection settings (manual): register `scans` as a required check (TC-07)

_(Note: `pre-push`/`verify-change.mjs` do NOT go through `runScans` — pre-push runs `harness:verify`, and
verify-change runs individual `harness:scan:*` commands — so parallelizing the runner does NOT speed the
pre-push gate. The local win is on direct `pnpm harness:scan` and `harness:verify:release`.)_

## Completion Criteria

- [x] TC-01: `runScans` executes scans concurrently (bounded pool), not one-at-a-time; asserted by a unit
      test with fake scans that records overlapping start/finish (or a max-observed-concurrency > 1).
      → `run-all-scans.test.mjs` "runs scans concurrently under a bounded pool" asserts `maxActive>1` and
      `≤3` (the passed cap). 7/7 pass.
- [x] TC-02: the summary contract is unchanged — `✓ <name>` per scan, `all N scans passed` / `N of M
scans failed`, aggregate exit code 0 iff all pass; a failing fake scan still surfaces its output.
      → "surfaces a failed scan's captured output" asserts `boom (FAILED)` + output shown, passing output
      suppressed, `1 of 2 scans failed`; the existing all-pass/multi-fail/exit tests still hold.
- [x] TC-03: `pnpm harness:scan` locally exits 0 and is materially faster than the sequential baseline
      (record before/after wall-clock). → sequential baseline 9.9s → parallel **4.65s** (48/48 pass).
- [x] TC-04: `.github/workflows/ci.yml` — `scans` job has **no `needs`** and runs `harness:scan --skip
dist --skip build-contracts` + `harness:test`; `quality` keeps `needs: build` and runs `harness:verify`
      **+ the `build-contracts` scan after dist restore**; both jobs use the build/quality skip-shape (no
      job-level `if`; main-base no-op + step-level `if`); YAML valid. → verified by inspection + node parse.
- [x] TC-05: full `pnpm harness:scan` 48/48 + `pnpm harness:test` green; full-repo typecheck 0.
      → harness:scan 48/48 ✓, harness:test 293/293 ✓, full-repo `pnpm typecheck` exit 0 ✓.
- [x] TC-06: **coverage preserved** — `build-contracts` still validates dist on a source/build-change PR
      (it runs in `quality` after dist restore, exactly as today); no scan silently no-ops. The dist-less
      `scans` job never runs `build-contracts`. → `harness:scan:build-contracts` entry added; runs in
      `quality` after dist restore; `scans` job passes `--skip build-contracts` (46/46 dist-less).
- [ ] TC-07: `scans` is registered as a **required status check** on `develop`/`main` branch protection
      (a red `scans` blocks merge even with a green `quality`) — recorded as done in the Evidence Log.
      → MANUAL branch-protection change; flagged to user as a release-blocking checklist item (pending).

## Test Plan

Unit-test the parallel `runScans` with synthetic scans (assert concurrency > 1 + summary/exit contract +
failure-output surfacing). Locally time `harness:scan` before/after (TC-03). Validate the CI YAML change by
inspection + the harness's own governance scans (release-governance asserts run-all-scans wiring). Land via
the standard flow; the speed win is realized on this PR's own CI and all subsequent stage PRs. Institutionalize
the "don't serialize CI behind unused upstream output; parallelize independent suites" lesson via
lesson-to-harness.

## Tasks

- [x] Parallelize `runScans` (bounded worker pool) + `spawnScan` capture-on-pipe — `run-all-scans.mjs`.
- [x] Rewrite `run-all-scans.test.mjs` order assertion → concurrency (TC-01) + failure-output (TC-02).
- [x] Add `harness:scan:build-contracts` package.json entry.
- [x] CI: new `scans` job (no `needs`) + `quality` build-contracts carve-out after dist restore.
- [x] Institutionalize the "don't serialize CI behind unused upstream output" lesson (lesson-to-harness).
- [ ] TC-07 (manual): register `scans` as a required status check on `develop`/`main` protection.

## Evidence Log

- 2026-07-09 GATE-APPROVAL round 1 — proposal-reviewer REVISE (direction endorsed; 4 fixes). (1) **Critical**:
  `--skip dist` does NOT skip `build-contracts` (`check-build-output-contracts.mjs` reads `packages/*/dist`,
  silently no-ops without it) — carve it into `quality` (after dist restore); `scans` runs `--skip dist
--skip build-contracts`. It is the ONLY non-skipped scan that reads build output (verified). (2) Register
  `scans` as a required check + build/quality skip-shape (no job-level `if`; main-base no-op) so it never
  lingers pending (INFRA-026 gate-blind-spot; verification-pipeline-plan §76/§139/M6). (3) Test target is
  `run-all-scans.test.mjs:24` (order assertion), not harness-scripts. (4) pre-push/verify-change don't use
  `runScans` — corrected the local-speedup claim. Confirmed: runner sequential, concurrency safe (only
  `doc-examples` writes, to an isolated cache), summary parsing safe. All folded in.
- 2026-07-09 GATE-APPROVAL round 2 — proposal-reviewer **ENDORSE**. All 4 fixes confirmed against code
  (build-contracts carve-out preserves coverage incl. its docs-PR no-op status quo; required-check safeguard
  - skip-shape; run-all-scans.test.mjs target; local-claim correction). Non-blocking impl note: invoke
    build-contracts in `quality` via a dedicated entry (`harness:scan:build-contracts` / `node
scripts/harness/check-build-output-contracts.mjs`) whose non-zero exit fails the step. Approved → implement.
- 2026-07-09 GATE-IMPLEMENT — `runScans` rewritten to a bounded worker pool (cap =
  `availableParallelism()-1`); `spawnScan` pipes+captures stdout/stderr → `{code,output}`; failed scans print
  captured output in original order, passes stay one-line `✓`; summary/exit contract byte-identical.
  `harness:scan:build-contracts` added to package.json. `ci.yml`: new `scans` job (no `needs`; main-base
  no-op + step-level `if`; runs `harness:test` + `harness:scan --skip dist --skip build-contracts`);
  `quality` keeps `needs: build` and now runs `harness:scan:build-contracts` after dist restore.
  `run-all-scans.test.mjs` order assertion replaced with concurrency (TC-01) + failure-output (TC-02) tests.
- 2026-07-09 GATE-VERIFY — TC-01/02 unit tests 7/7 pass; `pnpm harness:test` 293/293 (35 files);
  `pnpm harness:scan` 48/48 in **4.65s** (baseline 9.9s sequential → TC-03); `scans`-job command
  (`--skip dist --skip build-contracts`) 46/46; `build-contracts` standalone exits 0 (TC-06); ci.yml parses,
  `scans` job + build-contracts step present (TC-04); **full-repo `pnpm typecheck` exit 0** (TC-05). TC-07
  (required-check registration) remains a manual branch-protection step, flagged to the user.
