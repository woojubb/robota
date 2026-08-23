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

## The direction of the danger is conditional, not absolute

Recorded because an earlier statement of this lesson made it absolute and that was wrong. A corpus
wider than the claim does not always conceal: it suppresses a **presence** proof (the extra corpus
supplies the thing being looked for, so a real absence reads as present), and it merely manufactures
work for an **absence** proof. Which way it fails depends on what the guard is trying to establish,
and a sibling entry in this corpus still states it as an absolute — see
[[a-wide-corpus-makes-a-guard-pass-quietly]], which needs the same qualification.

## The limit of this file, measured on this file

**Writing the lesson down is not applying it, and this entry has the datum to prove it.**

Four commits after committing this file, in the same branch and the same series, I shipped the
identical defect: the `THookEvent` row in `packages/agent-core/docs/SPEC.md` said **13 events**,
while two other lines of the same document said 16 and prose I added in the same change said
"the other fifteen events are advisory". Three statements of one quantity in one SSOT, two of them
written by me, disagreeing. Review caught it; this file did not.

So state the limitation plainly rather than let the file imply otherwise:

> **A memory entry is a record that a lesson was learned, not a mechanism that applies it.** Its
> half-life against the author's own next commit is short — measured once, at about four commits.

The practical consequence is that "filed and written down" is not closure. A lesson only becomes
load-bearing when something mechanical enforces it — a scan, a gate, a test that goes red. Where a
mechanism is possible, the entry is a placeholder for one; where it is not, the entry must be
re-read at the moment of the work rather than trusted to have been absorbed.

For this specific lesson the mechanism is cheap and does not exist yet: nothing checks that two
counts of the same quantity in one document agree. `scan-hook-catalog` guards `HOOK-CATALOG.md`,
not the SPEC tables, which is why the row above went out.
