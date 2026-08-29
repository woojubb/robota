---
title: 'HARNESS-087: most declared sizes are checked by nothing'
issue: https://github.com/woojubb/robota/issues/2325
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2325#issuecomment-5459592574
created: 2026-08-11
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-087 — most declared sizes are checked by nothing

**Source:** the measured population of the `measurement-provenance` floor when it was adopted.

## The problem

Sixty-two harness modules carry the declaration marker. Eight export the counter and assert it; the
other fifty-four are recorded as pending in `scripts/harness/measurement-provenance-pending.json`.
Two shapes, and the first dominates — 44 against 10:

- no export matches the reader convention — usually because the counter lives in `main()` and is
  exported by nothing, and in at least one case because it is exported under a third spelling;
- the counter is exported but its value is asserted by nothing, or by a lower bound.

Every one of those numbers is read as evidence that a scan ran over what it names, and every one can
be wrong by any amount in either direction with the scan still reporting a pass. The ledger makes the
debt visible and makes any growth a deliberate edit to a checked-in file — a new declaring module is
a finding until someone classifies it. Nothing ratchets the list's length, so growth is visible
rather than impossible, and nothing here reduces it.

One of the 54 is the runner itself, which carries the marker to PARSE what the scans it runs print,
and publishes two sizes of its own — how many scans ran, and how many declared — in prose rather than
on the marker channel. It is in the list because the population is "carries the marker", which
deliberately over-includes; resolving it means deciding whether those two sizes should be declared
like every other, not deleting the entry.

## Done when

- the `pending` list is empty — every subject sits in `covered` — OR each remaining entry carries a
  reason specific to that scan rather than the shared adoption reason.
- Every migrated scan's counter is incremented at its traversal — not derived from a collection, a
  configuration entry, or a second walk — with the exact-value and after-a-second-run cases the rule
  requires.
- The pass line's covered/unmet split is read as the progress measure while the list shrinks.

## Notes

The floor re-measures both lists on each run, so an entry that comes to meet it is itself a finding
and a covered subject that stops meeting it is a regression: the list cannot silently outlive its
reason or absorb work that used to be checked, and migration order is free. Batching by shape is likely
cheapest — the `main()`-local counters all need the same holder-and-reader extraction that the eight
covered scans already demonstrate.

HARNESS-119 local review measured one concrete instance: `scan-review-findings.mjs` reads three files
but reports nine artifacts because it increments once per assertion, and a second collection in the
same process reports eighteen because the holder is not reset. Issue #2325 records this exact migration
target and its required exact-value plus second-run regression tests.
