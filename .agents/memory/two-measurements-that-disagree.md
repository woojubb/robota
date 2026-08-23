# Two measurements that disagree are one unresolved finding

**The sentence, because it is the whole entry:**

> Two measurements of the same quantity that disagree are not two facts. They are one unresolved
> finding, and the gap is where it lives.

## Where it was learned, measured

SEC-016 (issue #2093). I wrote a scan asserting that a hook event declared `enforcing` has a fire
site that awaits `runHooks` and reads `.blocked`. In the same change I wrote two numbers for the same
quantity:

| source                                       | count                                |
| -------------------------------------------- | ------------------------------------ |
| the spec's sibling-scan measurement, by hand | **13** fire sites across **8** files |
| the scan's own `::examined::` line           | **17** fire sites across **9** files |

Both are in the change. I reconciled neither. Review then deleted the ENTIRE production `PreToolUse`
gate and the scan still passed — because the four-site delta was
`packages/agent-session/examples/verify-hook-outcome-contract.ts`, a demo whose whole job is to
exercise the gate, being counted as evidence that the gate exists.

**The delta WAS the defect, sitting in plain text in my own document.**

## Why it is easy to miss, specifically

The disagreement pointed the reassuring way. A guard reporting a LARGER population reads as broader
coverage, so `::examined:: 17` looks strictly better than `13`.

**The direction of that danger follows the direction of the CLAIM, not the width of the corpus** —
stated as an absolute in the first version of this entry, which was wrong:

- A **presence** proof ("the gate exists", "some fire site honours this row") is SUPPRESSED by extra
  corpus. False negative, and it gets believed. This case.
- An **absence** proof ("nothing resolves to this any more") can only be MANUFACTURED by extra
  corpus. False positive, and it gets investigated. Sweeping wide is correct there, and narrowing is
  the defect.

So the repair is conditional: require the subject positively for a presence proof; sweep everything
and treat extra hits as work for an absence proof. See
[`a-report-states-what-it-could-not-see.md`](a-report-states-what-it-could-not-see.md) for the
adjacent property.

## What to do instead

When two numbers for one quantity appear — a hand count and a tool count, a spec figure and a scan
figure, a base named in a record and the base a command actually ran against — **stop and resolve the
gap before either is used.** Do not write both down. Do not pick the one that fits. The gap is a
finding that already exists; writing both down is deciding not to look at it.

Three near-misses in this repository trace to the move: this one; a plan nearly abandoned because six
"outside references" were all comment mentions; and a pull request green against a base that had
moved, visible only when the two trees were put together.

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

## Related

- Issue #2227 — the too-wide-corpus guard class, and the positive-inclusion repair
  (require product source; never exclude the known-bad, because that set grows without you).
- Issue #2181, issue #2215 — the opposite direction, a guard seeing too little.
- [`claimed-without-reading-back.md`](claimed-without-reading-back.md) — never cite two tool runs
  that measured different trees. Same family: this entry is what to do when you already have.
