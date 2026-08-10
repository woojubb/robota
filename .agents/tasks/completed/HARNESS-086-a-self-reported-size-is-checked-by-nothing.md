---
title: 'HARNESS-086: a self-reported size is checked by nothing'
status: done
completed: 2026-08-10
created: 2026-08-10
priority: medium
urgency: soon
area: scripts/harness, .agents/rules
depends_on: []
---

# HARNESS-086: a self-reported size is checked by nothing

## Problem

`::examined::` made every scan publish the size of what it walked, and nothing checks that number.
It is the one output with no consumer to falsify it: a finding list is read and argued with, but a
size is read as reassurance and never re-derived. So a counter can be wrong by any amount in either
direction while the scan reports a healthy pass.

Four distinct forms of that defect were produced in a single change, all found by review:

1. a scan with two walks published one number, silently losing the larger population;
2. the counters were themselves untested;
3. one was asserted with a lower bound, which every over-count satisfies;
4. one was derived from a collection of results rather than the traversal, losing every duplicate.

Two earlier instances are recorded in HARNESS-057: a count read off a static table, and one read off
a changed-file list rather than the walk.

## Resolution

**Rule.** `.agents/rules/measurement-provenance.md` — the number is produced by the traversal that
does the work; one subject, one number; the counter is an output and is tested as one (an exact
value against a fixture of known size, plus a second run over a differently-sized one). Registered in
the rules index under Process Sub-Rules and as common-mistakes entry 86.

**Mechanism.** `scripts/harness/scan-measurement-provenance.mjs`, registered as
`measurement-provenance` in `run-all-scans.mjs` and pinned in `MANDATORY_TREE_GUARDS` (the
guard-scope floor executes it against a bare root and proves it throws). It fails when a module
exporting a size reader has no sibling test, no exact numeric assertion on the reader, or no case
that runs the finder over two DIFFERENT inputs and then asserts the counter.

The reset case is judged by SHAPE, not by the case's title. A title-matching first version was
falsified against the live tree: it failed two suites that already prove the property under a
different wording, and would have passed a case that only said it resets.

**Swept.** 7 modules exporting 9 size readers were audited by the new scan. A manual pattern sweep
had reported all but one compliant; the scan found the remaining gap in
`scan-no-fake-in-src` — no exact assertion and no reset case — which was closed with two cases in
`scripts/harness/__tests__/scan-no-fake-in-src.test.mjs`.

**Proved.** Against the pre-fix tree the scan exits 1 and names the gap. Removing
`examinedShippableFiles = 0;` from the swept module turns both new cases red (`expected 1649 to be 3`
— the live tree size carried into a fixture run — and `expected 1652 to be 3` after accumulation);
restoring it turns them green. The scan's own 11 cases cover each finding type, both fail-closed
refusals, and its own two counters.

**Not closed here.** The second lesson mined in the same pass — defensive code written for a state
the surrounding code has already excluded — has no mechanism, because logical reachability is not
decidable and the lint layer sees only syntactic unreachability. Filed as HARNESS-085 with the
tractable proxy (branch coverage over the harness modules, ratcheted as a per-module set).
