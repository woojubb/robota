# Two disagreeing measurements are one finding, not two facts

## STATUS: measured 2026-08-23; three instances in one session, plus two more the same day

In-repo mirror (memory-mirroring rule). Host mirror: `two-disagreeing-measurements-are-one-finding`.

## The shape

When two measurements of the same quantity disagree, that is not two facts to write down. It is one
unresolved finding, **and the defect lives in the gap.**

Instances measured in one day:

- A scan reported 17 hook fire sites where the spec had measured 13. Both numbers were recorded. The
  four extra were `examples/` files letting a demo script vouch for production code that could be
  deleted entirely without failing the scan.
- A pattern match reported six entangled types where an architecture map said otherwise. The six were
  comment mentions; the naive reading would have abandoned a correct plan.
- A pull request was green against the base it was cut from and broken against the base it would land on.
- A branch's `--max-warnings` was read from its own `package.json` while its count was re-measured
  against the current tree — **a cap and a count are a pair, and verifying one operand lets the
  unverified one decide the answer.**
- A count of files containing a regex literal was produced three times by three methods and was wrong
  three times; the fourth move was to delete the number, because the limitation was the point.

## How to apply

Before writing a second count of something already counted, **reconcile it**. If it cannot be
reconciled, that is the deliverable, not the counts. A disagreement is the cheapest signal a defect
ever produces, and recording both numbers converts it into no signal at all — the document then reads
as thorough rather than as contradictory.

Related: [[enumerating-a-sink-is-not-covering-it]], [[a-wide-corpus-makes-a-guard-pass-quietly]]
