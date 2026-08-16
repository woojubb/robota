---
title: 'PROC-010: recording a re-plan disposition labels the CURRENT pull request, but a re-plan found before any change exists has only the filing PR to label — so the mechanism blocks the very artifact that makes the root item exist, and instructs the author to close it'
status: todo
created: 2026-08-16
priority: medium
urgency: soon
area: scripts/harness, .claude/hooks
depends_on: []
---

# PROC-010: the re-plan label blocks its own filing

Found while executing CORE-038 (2026-08-16), which it blocked.

## Problem

`finding-depth.md` says a `FOUNDATIONAL` finding takes **re-plan** or **containment**, and re-plan
"HALTS the loop and is reported with its root item". The mechanism for that report is
`scripts/harness/record-local-review.mjs --disposition re-plan`, which publishes the
`disposition-re-plan` label to the current pull request; `.claude/hooks/merge-gate.sh:156-160` then
refuses to merge that PR — _"A foundational finding withdrew this change rather than patching it …
close it and work the root item instead."_

That is correct when the re-plan withdraws **a change the PR carries**. It is wrong when the re-plan
is reached **before any change exists**.

In that case the only pull request in existence is the one that FILES the root item and closes the
symptom item. Labelling it means:

- the merge gate refuses the PR whose entire content is the root item's problem statement and the
  symptom's closure;
- its instruction — "close it and work the root item instead" — would **discard the root item**,
  because the root item exists only inside the PR being closed;
- the author's only route is to remove the label, which the gate defines as _"what un-withdraws it"_
  — i.e. to assert the opposite of what happened.

Measured: on PR #1751 (CORE-038 → CORE-043) the label was published, the PR became unmergeable, and
the label had to be removed by hand. The disposition is still recorded, correctly, in three places
that are not a label: the symptom item's `## Outcome`, the root item's header, and the PR body.

## Why it matters beyond the inconvenience

The gate's refusal is fail-closed and its override is `MERGE_GATE_ACK=1`. A rule whose correct
application produces a false refusal is the shape `git-branch.md` names explicitly: _"a gate that
trains people to route around it has already failed."_ The first author who hits this and reaches for
the override has been taught that the disposition flag is something to avoid, which is the opposite of
what `finding-depth.md` wants — it wants the disposition recorded.

Note also that `record-local-review` already refuses to record a disposition when no PR resolves
(PROC-007's rule), so the author is pushed to open a PR _first_ and then record — which is exactly the
sequence that produces the mislabelling.

**A second instance landed the same day.**
[PROC-011](PROC-011-merge-gate-demands-a-review-its-own-classifier-withheld.md): the merge gate
demands a reviewer verdict on a documentation-only PR that the review automation deliberately skips,
so that PR also ends in `MERGE_GATE_ACK=1`. Two different mechanisms, one shape — the gate refusing a
PR because of a state the harness itself produced. Whatever fixes one should be checked against the
other.

## Direction

The distinction the label needs to carry is **what the PR contains**, not what the verdict was. A
re-plan whose finding was raised against a change withdraws that change; a re-plan reached before any
change exists withdraws nothing and its PR must land.

Options, none chosen here because this is a judgement about the enforcement design rather than a
defect with one right answer:

- Have `record-local-review` distinguish the two — e.g. a re-plan recorded on a PR whose diff contains
  no source change is a _filing_, not a withdrawal, and publishes the disposition without the blocking
  label.
- Or keep the label unconditional and teach `merge-gate.sh` the same distinction.
- Or give the filing case its own disposition value, so the vocabulary says which happened.

Whichever is taken, `finding-depth.md`'s prose should say plainly that a re-plan can be reached before
a change exists, since today it reads as though a foundational finding is always raised against a diff.

## Test Plan

- A case pinning that a re-plan recorded on a source-free PR does not produce a merge-blocking state.
- A case pinning that a re-plan recorded on a PR carrying source changes still does.
- `depth-verdict-reachable.test.mjs` already enumerates the consumers of the depth vocabulary; whatever
  distinction is introduced belongs in that enumeration so it cannot be added for one consumer only.

## User Execution Test Scenarios

Not applicable — this is harness/process machinery with no runnable user-facing behaviour. Verification
evidence belongs in the engineering test plan above.
