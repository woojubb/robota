---
title: 'HARNESS-081: the examined-adoption ratchet never runs where it binds'
status: done
completed: 2026-08-09
created: 2026-08-09
priority: high
urgency: next
area: scripts/harness
depends_on: []
issue: https://github.com/woojubb/robota/issues/1673
---

# HARNESS-081: the examined-adoption ratchet never runs where it binds

## Problem

`run-all-scans.mjs` compares the count of scans that declare `::examined::` against
`examined-adoption-baseline.json` — but only when NO scan was skipped
(`checkAdoption: scans.length === SCAN_COMMANDS.length`). The CI `scans` job always runs with
`--skip dist --skip build-contracts`, and a local run without a built tree self-skips the same two.
So the one environment the ratchet exists to bind — the required check — never evaluates it, and
the local runs that do evaluate it measure a different population (the dist-dependent scans add
their declarations only when a build exists).

This is `registered-is-not-reached` (PROC-003's class) applied to a ratchet: the check exists, is
wired, and is green everywhere it actually executes, while the property it freezes drifts.

## Evidence

Measured 2026-08-09, during #1617/#1670 review:

- The frozen baseline on `develop` says `50`. A full local run on a built develop-derived tree
  measures `51`; with CI's `--skip` pair it measures `50` — and with skips the ratchet is not
  evaluated at all, so neither number ever faces the frozen one in CI.
- On the #1670 branch (one new declaring scan), a built full run prints
  `103 scans passed, 2 skipped (52 declared what they examined)` — two scans STILL self-skip on a
  built tree, so even locally the exact-match check is disarmed in practice.
- Three review rounds on #1670 flagged the `50 → 52` bump as arithmetically impossible for a
  one-scan diff; the resolution required hand-measuring because no gate anywhere answers it.

## Direction

Options, not prescribed here: evaluate adoption over the NON-SKIPPED population with a per-scan
declaring set frozen instead of a single count (a skipped scan neither adds nor subtracts); or
record which scans declare, so the ratchet compares sets and skips are subtractable; or arm the
check in CI by freezing the CI-invocation count separately. Whichever is chosen, the exact-match
single integer over a variable population is the defect: the population must be part of what is
frozen.

## Test Plan

- Red-first: a fixture run with one scan skipped must still fail when a previously-declaring,
  non-skipped scan stops declaring.
- The CI invocation (`--skip dist --skip build-contracts`) must evaluate the ratchet.
- `pnpm harness:scan` and `pnpm harness:test` green.

## User Execution Test Scenarios

**Does not apply.** Harness-internal ratchet; no user-facing surface.

## Resolution

Landed on branch `fix/harness-081-adoption-set`. The baseline is now a frozen SET of declaring scan
names (`{ "declaring": [ … ] }`), not a single count:

- `judgeExaminedAdoption(declaringNames, evaluableNames, …)` compares SETS. FELL = a frozen scan
  that RAN this pass but stopped emitting `::examined::`; ROSE = a scan that declared but is not
  frozen. A `--skip`'d scan is absent from `evaluableNames`, so it is neither judged nor faulted —
  which is exactly what lets the ratchet bind under CI's `--skip dist --skip build-contracts`.
- The `checkAdoption: scans.length === SCAN_COMMANDS.length` gate is gone; the ratchet always runs
  (CI included). A new `--write-adoption-baseline` flag re-freezes the set, MERGING so a run under
  `--skip` keeps the frozen entries for the scans it did not evaluate.
- An earned zero (`::examined:: 0 … ::expected-empty::`) counts as a declaration (marker adopted),
  so a dormant-by-design scan is not read as a fall.

Verified: the CI-shaped invocation evaluates the ratchet (a frozen-but-non-declaring scan FELLs
under `--skip dist --skip build-contracts` — red-proved by hand); the set-semantics and the
skip-does-not-disarm case are unit-tested in `run-all-scans.test.mjs`; full harness suite (3086)
and `pnpm harness:scan` green.
