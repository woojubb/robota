---
title: 'HARNESS-112: a loop run leaves no record, so escape=no-progress is a claim nothing can check'
status: in-progress
created: 2026-08-19
priority: high
urgency: now
area: scripts/harness, .agents/loop-runs, .agents/rules, .agents/skills
depends_on: []
---

# HARNESS-112: record what a loop run actually did

GitHub issue: https://github.com/woojubb/robota/issues/1874

## Objective

Give a loop run a durable, committed record, so that `escape=no-progress` — declared by eleven skills and
required by `scan-loop-contract.mjs` — becomes a claim something can check.

Today the string `no-progress` occurs in exactly two files in the tree: the scan that requires the
declaration and that scan's own test. 16 of 58 skills declare a loop; zero runs are recorded. A loop that
converged, one that exhausted, and one that was abandoned at round 1 leave a byte-identical tree.

## Spec

`.agents/spec-docs/active/HARNESS-112-a-loop-run-leaves-no-record.md`

## Plan

- [ ] TC-01: `loop-run.mjs open --loop <s>` prints a runId and appends an entry whose `closed` is null.
- [ ] TC-02: `round --findings <n>` appends to `roundFindings`; the array IS the round count.
- [ ] TC-03: `close` seals the entry; a later `round`/`close` on the same runId exits non-zero.
- [ ] TC-04: `--terminal no-progress` is refused for a skill that declares no such escape, accepted for one
      that does.
- [ ] TC-05: `--terminal bound-reached` is refused for a skill declaring no numeric bound, accepted for one
      that does.
- [ ] TC-06: a terminal reason outside the vocabulary is refused and the vocabulary is named.
- [ ] TC-07: the scan fails a ledger whose filename names no loop-declaring skill.
- [ ] TC-08: the scan fails a malformed ledger line naming file and line, and does not skip it.
- [ ] TC-09: the scan fails an entry left OPEN for more than 7 days.
- [ ] TC-10: both new modules are `covered` under `measurement-provenance` (exact value + reset case).
- [ ] TC-11: `pnpm harness:scan` exits 0 with `loop-run-records` registered.
- [ ] TC-12: every skill declaring `loop:` names the recording entry point in its body.

## Test Plan

Unit tests under `scripts/harness/__tests__/` drive the recorder against a temp workspace root and the
scan against a fixture skills tree, asserting both directions of every refusal — a vocabulary member the
declaration does not permit, a malformed line, a stale OPEN entry — so the guard is proven able to fail
rather than assumed to be. `pnpm harness:scan` covers registration. The one thing no test can establish is
that a run which was never opened happened at all; that ceiling is stated in the rule and in the scan
header, and HARNESS-113 is what converts it into a requirement for new loops.

## Progress
