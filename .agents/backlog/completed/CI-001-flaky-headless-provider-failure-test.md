---
title: 'Fix flaky CI test — agent-transport headless provider failure (CLI-064 TC-02)'
status: done
completed: 2026-07-25
---

# Fix flaky CI test — agent-transport headless provider failure (CLI-064 TC-02)

## What

`packages/agent-transport/src/headless/__tests__/headless-provider-failure.integration.test.ts`
→ "headless provider failure exit codes (CLI-064) > **TC-02: json format exits 1 with subtype
error and error_code api_error**" fails intermittently in the `compat-node18` CI job, while
passing reliably when run in isolation locally.

## Why

The failure is a flake, not a real regression:

- Reproduced green locally on develop/main: `pnpm --filter @robota-sdk/agent-transport test -- --run src/headless/__tests__/headless-provider-failure.integration.test.ts` → 2 passed.
- It only fails inside the full parallel `pnpm -r run test --coverage` matrix in CI.
- The same `compat-node18` job has failed on unrelated sync-to-main PRs (AGPL relicense,
  DOCFIX) — i.e. it is a recurring flake, independent of the PR content.

It blocks/red-flags otherwise-clean PRs (observed on PR #816, a www-copy-only change) and
erodes trust in CI signal.

## Likely causes to investigate

- Shared/global state across concurrently-running vitest projects (env vars, stdout/stderr
  capture, process exit code interception) in the headless integration harness.
- Timing/ordering assumption in the JSON-format assertion (error_code `api_error`, subtype
  `error`) that only surfaces under load.

## Done When

- Root cause identified and fixed (deterministic isolation of the headless run / assertion).
- The test passes reliably under the full `pnpm -r run test --coverage` run, including in the
  `compat-node18` job, across multiple consecutive CI runs.

## User Execution Test Scenarios

1. Re-run the `compat-node18` CI job 3+ times on an unrelated PR → no flaky failure of TC-02.
   (The `compat-node18` job was removed when the Node floor was raised; the equivalent gate below —
   the target test + full coverage suite green across repeated parallel/loaded runs — is what was run.)

## Outcome (done 2026-07-25)

**Root cause (proven, not the backlog's "assertion-ordering" guess).** The failure is a filesystem
race, not an assertion flake. The headless runner (`packages/agent-transport/src/headless/headless-runner.ts`)
resolved its exit-code promise from the terminal `complete`/`interrupted`/`error` session event. Those
events fire from INSIDE the turn (`executePromptTurn`), which is awaited by `session.submit()` whose
`finally` then runs `persistSession()` and the checkpoint finalize — writing files under
`cwd/.robota/checkpoints/session_.../`. Because the runner fired `void session.submit(...)` and resolved
off the event, `transport.start()` returned while that persistence I/O was still in flight. The test's
`afterEach` then ran `rmSync(cwd, { recursive: true, force: true })`; `force:true` suppresses `ENOENT`
but NOT `ENOTEMPTY`, so when a checkpoint file landed mid-`rmdir` the cleanup threw and vitest attributed
the thrown `ENOTEMPTY` to the just-finished test — "TC-02: json format …". Under the parallel
`--coverage` matrix the trailing writes are slower, widening the race window; in isolation it is fast
enough to never lose.

**Deterministic reproduction.** A standalone harness ran the exact TC-02 json scenario + the real
`afterEach` `rmSync` in a loop under 16 CPU burners (load avg ~12):

- Pre-fix: `N=600 assertFails=0 rmThrows=4` (all `ENOTEMPTY` on `.robota/checkpoints/session_.../`).
  `assertFails=0` confirms the JSON.parse/matchObject was never the problem.
- Post-fix: `N=800 assertFails=0 rmThrows=0`; interleaved text+json leak-detector `N=800 fails=0 leaks=0`.

**Fix (source, `agent-transport` only).** The runner now records the exit code and AWAITS the underlying
`session.submit()` / slash-command operation before `run()` resolves, so all trailing turn work (session
persistence, checkpoint finalize) has drained before `start()` returns — no writes outlive cwd. A small
`createExitCodeLatch` also guarantees exactly one terminal record per run (defense-in-depth against a
terminal event + a late submit rejection both writing). Exit codes and output shape are unchanged. This
also hardens the real headless CLI: a `robota -p …` process no longer risks exiting before its session
checkpoint is written.

**Verification (all green).**

- Target test in isolation: 2 passed.
- Target test 5× under CPU load: 2 passed each.
- Full `@robota-sdk/agent-transport` suite with `--coverage`, 3× under load: 14 files / 56 tests passed each.
- `pnpm -w typecheck`: clean. `node scripts/harness/run-all-scans.mjs`: all 60 scans passed.
