---
title: 'INFRA-136: loop-run open refuses a run another day left open and only hand-editing the ledger gets past it'
issue: https://github.com/woojubb/robota/issues/2406
status: todo
created: 2026-08-28
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# INFRA-136: loop-run open refuses a run another day left open and only hand-editing the ledger gets past it

## Objective

`node scripts/harness/loop-run.mjs open --loop <skill>` refuses to open a run while any earlier run of
that skill is still OPEN, and the refusal names no way past it. When the open run was left by an
earlier day's session — the common case after a session ends mid-loop — the only way to open the
next run has been to hand-edit `.agents/loop-runs/<skill>.jsonl`, which is exactly the amendment the
ledger exists to forbid. `open` should close a run opened on an earlier UTC calendar day as
`abandoned` with `ref: "superseded by <new run id>"`, print one line saying so, then open the new run;
a run opened the same UTC day is still refused exactly as today.

## Plan

- [ ] Failing test: `openRun` on a ledger whose OPEN run was opened on an earlier UTC day closes it as `abandoned` and opens the new run; a same-day OPEN run is still refused
- [ ] Fix in `openRun` (`scripts/harness/loop-run.mjs`) and one printed line from the `open` CLI case
- [ ] `pnpm exec vitest run scripts/harness/__tests__/loop-run.test.mjs` and the affected scans green

## Test Plan

- `scripts/harness/__tests__/loop-run.test.mjs`: earlier-day OPEN run is closed `abandoned` with `ref: "superseded by <new run id>"` and the new run is appended; same-day OPEN run still throws `already has run`; the CLI `open` prints one line naming the superseded run.
- `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` exits 0.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Reason: not applicable — the change is internal to a harness script's ledger handling with no
user-facing product surface; the unit test and the scans are the whole verification.
