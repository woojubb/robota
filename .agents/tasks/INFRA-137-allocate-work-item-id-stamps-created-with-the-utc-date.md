---
title: 'INFRA-137: allocate-work-item-id stamps created with the UTC date'
issue: https://github.com/woojubb/robota/issues/2415
status: todo
created: 2026-08-28
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# INFRA-137: allocate-work-item-id stamps created with the UTC date

## Objective

`scripts/harness/allocate-work-item-id.mjs` stamps `created:` in the new Task record with the UTC
calendar date (`new Date().toISOString().slice(0, 10)`), while every other date the harness writes —
gate entries, `completed:`, the delegated-class `Registered` column, `gate.mjs`'s `localDate()` — is
the LOCAL calendar date. A record allocated after midnight local time (before 09:00 KST, for this
repository's owner) is therefore dated one day BEFORE the gate entries that follow it, and a reader
of the record sees a Task whose first gate ran before it was created. The fix stamps the local
calendar date with the same `Intl.DateTimeFormat('sv-SE')` formula `gate.mjs` uses, so the two can
never disagree again, and a test pins the stamp under two time zones that never share a date.

## Plan

- [ ] Add a `localDate()` helper to `allocate-work-item-id.mjs` mirroring `gate.mjs`'s formula
      (importing `gate.mjs` pulls in `run-all-scans.mjs` and three scan modules — heavier than a
      five-line helper) and use it for `created:`
- [ ] Add a RED-first test: the exported helper gives different dates under `Etc/GMT-14` and
      `Etc/GMT+12` at the right instant, and the script's written record carries the local date
- [ ] Run the test file and the affected scans; commit with the `Lane: L1` trailer

## Test Plan

- `pnpm exec vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs` — the new
  `created:` test goes RED before the fix and GREEN after; the existing record-shape tests stay green.
- `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
  — no scan regresses on the two changed files.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

A user-execution scenario is **not applicable** to this item: it changes one harness script under
`scripts/harness/` that only repository maintainers run, and no package, app, CLI command, TUI
surface, or published API changes. There is no command a user of the product could run to observe a
difference; the verification surface is the script's own test file and the affected scan run named
in the Test Plan above.

## Bound spec document

`.agents/spec-docs/todo/INFRA-137-allocate-work-item-id-stamps-created-with-the-utc-date.md`
