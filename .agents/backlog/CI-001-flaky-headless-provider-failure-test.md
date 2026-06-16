---
title: 'Fix flaky CI test — agent-transport headless provider failure (CLI-064 TC-02)'
status: todo
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
