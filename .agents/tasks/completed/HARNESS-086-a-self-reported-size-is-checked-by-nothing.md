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
value against a fixture of known size, plus an assertion taken after a second run). Registered in
the rules index under Process Sub-Rules and as common-mistakes entry 86.

**Mechanism.** `scripts/harness/scan-measurement-provenance.mjs`, registered as
`measurement-provenance` in the runner and pinned in `MANDATORY_TREE_GUARDS` (the guard-scope floor
executes it against a bare root and proves it throws). Its subject set is DERIVED — every module
under the harness directory whose source CARRIES the declaration marker, the runner included — and it
fails one whose counter is not exported, whose value no live case asserts against an exact numeric
value, or which has no assertion after a second run of the finder.

Two earlier versions were falsified against the live tree and are the reason the shape above is what
it is:

- a first version required the reset case to be TITLED for the reset. It failed two suites that
  already prove the property under a different wording, and would have passed one that only said it
  resets. Judged by shape since.
- a second version derived its subjects from the READER'S NAME at depth 1 of one directory. Measured:
  61 harness modules declare a size, and that version governed 8 of them — every module spelling its
  reader differently, or keeping the counter in `main()`, left the population silently. That is the
  same silent-permit enumeration the rule exists to prevent, committed by the check adopting it.
- a third version took the population from the runner's registration list, which dropped a module
  that publishes two sizes without being registered. Registration is not what makes a published size
  evidence, so the population is the directory walk.
- a fourth exempted the runner, on the ground that it CONSUMES the marker to build its report. It
  does — and it also publishes two sizes about its own work, which the exemption hid. There is no
  exemption now; the runner is classified in the ledger like every other subject.
- a fifth tried to narrow the population to modules that PRINT the marker, so the published number
  would describe what it names. Measured: the harness prints through four channels including
  per-module local helpers, and the test dropped 26 real subjects — a silent exemption earned by the
  spelling of a print call. The population carries the marker instead, and the number says so.

**Measured population.** 62 declaring modules exporting 21 readers. Eight meet the floor; the other
54 are recorded in `scripts/harness/measurement-provenance-pending.json`. Every subject is classified
there as covered or pending — a subject in neither is a finding, so a new declaring scan cannot enter
unclassified — and both lists are re-measured on every run, so an entry that comes to meet the floor
is a finding and one that stops meeting it is a regression rather than a quiet move to the debt list.
The covered and unmet figures are reported separately in the pass line. HARNESS-087 burns the ledger
down.

**Swept.** Of the modules already exporting a reader, one was found non-compliant —
`scan-no-fake-in-src`, with no exact assertion and no reset case — closed with two cases in
`scripts/harness/__tests__/scan-no-fake-in-src.test.mjs`. A manual pattern sweep run before the
scan existed had reported the rest of that group compliant on the strength of the word "reset"
appearing somewhere in each test file; the scan disagreed with it in both directions.

**Proved.** Against the pre-fix tree the scan exits 1 and names the gap. Removing
`examinedShippableFiles = 0;` from the swept module turns both new cases red (`expected 1649 to be 3`
— the live tree size carried into a fixture run — and `expected 1652 to be 3` after accumulation);
restoring it turns them green. The scan's own 38 cases cover each finding type, both fail-closed
refusals, and its own four counters. The subject-derivation rewrite is covered by cases pinning both
reader spellings, the const and re-export forms, an export that exists only in a comment or a string,
a commented-out second run, a second run appearing only inside a string, an assertion taken before
the second run, a skipped case and a skipped suite, a negated assertion, a regular expression opened
after a keyword, and a module a directory down that no registry names.

**Not closed here.** The second lesson mined in the same pass — defensive code written for a state
the surrounding code has already excluded — has no mechanism, because logical reachability is not
decidable and the lint layer sees only syntactic unreachability. Filed as HARNESS-085 with the
tractable proxy (branch coverage over the harness modules, ratcheted as a per-module set).
