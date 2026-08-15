---
title: 'INFRA-100: make harness verification portable on the supported macOS toolchain'
status: done
created: 2026-08-15
priority: high
urgency: now
area: scripts/harness
depends_on: []
---

# INFRA-100: portable macOS harness verification

## Objective

Make the repository harness test tier produce the same evidence on stock macOS and Linux without
requiring Bash 5, GNU coreutils, or a caller-provided temporary-directory override. Preserve the
existing fail-closed witness, locking, and complete harness-test contracts.

## Spec

`.agents/spec-docs/done/INFRA-100-macos-harness-portability.md`

## Plan

- [x] TC-01: replace the Bash-4-only execution witness prelude and cover branch, function/subshell,
      stderr-isolation, and inert behavior on stock Bash 3.2.
- [x] TC-02: make the worktree-lock proof independent of host `flock` and GNU `date +%s%3N` using a
      hermetic test fixture and one Node-owned clock, retaining locked and unlocked controls.
- [x] TC-03: project `realpathSync(tmpdir())` only into the complete harness-test child process and
      unit-test that environment boundary.
- [x] TC-04: run the complete `scripts/harness/__tests__` tier through `harness:verify` without an
      ad-hoc `TMPDIR` override.
- [x] TC-05: rerun the original agent-provider-replay scoped harness command with scenario comparison.

## Progress

### 2026-08-15

- Reproduced 27 failures under the default macOS temp path and isolated seven platform assumptions
  after canonicalizing `TMPDIR`: six Bash witness cases and one BSD `date` timing case.
- GATE-WRITE and GATE-APPROVAL passed; the user delegated approval when the evidence is sound.
- Added a failing canonical-temp-root unit test, then made only the complete harness-test child
  receive `realpathSync(tmpdir())` as `TMPDIR`; 85/85 launcher tests pass.
- Replaced the Bash-4-only witness prelude with a Bash-3.2-compatible fixed-FD `DEBUG` trap and added
  function inheritance evidence. The focused witness, lock, and launcher run passes 145/145 tests.
- The first portable-timing run exposed a second host assumption: stock macOS has no `flock`.
  Updated the plan before proceeding and made the lock proof hermetic with a test-only fixture while
  preserving the production wrapper's documented degradation behavior.
- `volta run --node 22.14.0 pnpm harness:verify -- --scope packages/agent-provider-replay
--include-scenarios` exits 0 without a caller `TMPDIR`, including the complete harness tests,
  repository build, dependent typecheck, package test/lint/typecheck, and canonical scenario match.

## Decisions

- Keep the existing trace-file and parser contract; change only how Bash 3.2 writes the evidence.
- Canonicalize the temporary root at the harness-test process boundary rather than mechanically
  rewriting more than 100 independent CLI guards.
- Keep timing inside the parent Node test process so all child intervals share one monotonic clock.
- Supply `flock` only inside the test fixture; preserve the production wrapper's explicit
  missing-tool degradation contract.

## Blockers

None.

## Test Plan

Use the already observed seven-test RED state. Run the focused execution-witness and worktree-lock
Vitest files after each minimal fix, then run `harness-scripts.test.mjs` for the canonical temp-root
projection. Finish with the complete repository harness test directory via `pnpm harness:verify` and
the exact `pnpm harness:verify -- --scope packages/agent-provider-replay --include-scenarios` command.
Both final commands must run without a caller-supplied `TMPDIR` override and must exit 0.

## User Execution Test Scenarios

Not applicable — this changes repository-internal verification infrastructure and exposes no shipped
CLI, TUI, browser, application, public SDK, or example behavior.

## Result

All five completion criteria are implemented and verified on stock macOS Bash 3.2. The original
ARCH-014 scoped verification now exits 0 and matches the checked-in external-payload replay scenario;
lint reports nine pre-existing boundary-typing warnings and zero errors.
