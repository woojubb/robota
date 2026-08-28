---
title: 'HARNESS-057: a scan must report the size of the subject it examined, and zero must fail'
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2462#issuecomment-5457971404
priority: high
urgency: now
type: INFRA
area: scripts/harness
created: 2026-07-28
# HARNESS-053 and HARNESS-056 are the completed/open halves this builds on; HARNESS-052 is the
# sweep that found the class. Listed as lineage, not as blockers — 053 is already in completed/.
depends_on: [HARNESS-052, HARNESS-056]
---

# HARNESS-057 — one invariant that subsumes three recurring classes

## Problem

The most-repeated defect in this repository is a check reporting success over work it never did.
Measured across the audit: **at least twelve occurrences**, two full sweeps (HARNESS-052 passes 1
and 2), and thirty registered finders that returned `[]` over an absent subject. `run-all-scans.mjs`
was touched 53 times in 10 days; `scan-guard-scope-fail-closed.mjs` — the guard written to catch
vacuous guards — 27 times, and it **shipped containing three of its own defects, two masking each
other**.

Three symptoms have been chased separately, and they are the same thing:

| Symptom                                                      | Instance                                    |
| ------------------------------------------------------------ | ------------------------------------------- |
| Fail-open over an absent tree                                | `dist/ present on all 0 package(s)`, exit 0 |
| A SKIP renders as `✓` and counts toward "all N scans passed" | `HARNESS-056`                               |
| Depth-1 walk claims "all" over a subset                      | seven guards, "all 75 packages" over 55     |

Each was repaired instance by instance. Nothing prevents the next one, because nothing asks the
question they all answer wrongly: **how much did you look at?**

## Proposed direction

Every scan reports the size of the subject it examined, and the runner fails the suite when a scan
reports `0` without declaring an expected-empty reason.

That single invariant catches all three: an absent tree reports 0, a skip reports 0, and a depth-1
walk reports a count that visibly disagrees with the workspace — which is the thing a reader can
check at a glance and a follow-up scan can check mechanically.

Two design constraints, both learned the expensive way here:

- **Declaring an expected-empty subject must be possible**, or scans with legitimately empty
  subjects go red and the suite gets skipped. An expected-empty declaration is a reviewable line,
  not a silent default.
- **The declaration needs anti-rot scoped to the real tree.** An anti-rot that fires over a scratch
  fixture reports every entry stale on every test — this has now happened twice in this repository,
  once in `scan-workflow-permissions` and once in `scan-doc-folder-status-agreement`, both times
  fixed by scoping to the real subject.

## Progress — the mechanism is in, the migration is not

**Measured first, because the item's proposal needed a number: 18 of 97 registered scans state a size
on success in prose; 79 state none.** That is what makes the invariant a migration rather than an
edit, and it is why adoption is held as a ratchet.

`run-all-scans.mjs` now owns two halves of the invariant, on the marker channel it already had for
advisories:

```
::examined:: 24 rule documents
::examined:: 0 live plans ::expected-empty:: the pipeline is dormant by design
```

- **An unearned zero FAILS the suite.** A scan declaring `0` without saying why zero is correct is a
  pass over nothing, and the suite says so and exits 1. This half carries no exemption for a subset
  run — a scan claiming a pass over nothing is wrong however few of them ran.
- **Adoption is a RATCHET.** 11 scans declare today; the count may rise and must never fall, and a
  rise must be re-frozen in the same change. Demanding a declaration from all 97 at once would turn
  the suite red on arrival, and a suite that is red on arrival is skipped rather than fixed.

**A marker, not prose**, for the reason the advisory channel already gives: a regex over prose both
misses and invents. The eighteen sentences stay for humans; the marker is what the runner reads.

**The expected-empty declaration is a reviewable line in the scan's own output**, where the next
reader meets it — not a configuration file nobody opens. Both design constraints this item named are
therefore satisfied, and the anti-rot concern is moot: there is no separate registry to go stale.

### One defect its own tests caught

The ratchet was applied to every `runScans` call, and the runner's existing cases went red instantly:
a subset run — a `--skip`, or a caller passing three fixtures — reported a FALL that was only a
shorter list. Adoption is judged only when the whole registry ran. A ratchet over a subset counts a
number that means nothing.

### Red-proved

Changing one scan's declaration to `::examined:: 0 workflows` fails the suite with
`1 scan(s) reported a pass over nothing`, naming the scan and the door.

### Migration, batch 1 — and a correction to what this migration costs

**11 → 19 of 97.** Marked in this pass: the required-check dependency edges, filtered test
invocations, workspace packages in the publish registry, declared write scopes, required contexts on
the protected branch, workflows in two CI-history guards, and the memory fact files.

**The first estimate — "each is a one-line addition beside a number the scan already computes" — was
wrong, and the correction is the useful part.** It holds for the scans that print their count.
For the rest it does not: their finder returns findings and nothing else, so the number exists inside
the walk and dies there. Making it available is a per-scan change to what the finder hands back, and
the finder is usually imported by tests that assert on its findings — so a widened return shape
rewrites those tests to prove nothing new.

The memory-mirror scan shows the cheapest honest form: a module-level holder set where the walk
happens and read where the line is printed, leaving the finder's contract and its tests untouched.
That is still a deliberate edit per scan, not a one-liner, and the remaining ~77 should be read as
that size.

### The first declaration was itself the defect this item is about

Review caught it in the batch that added it. `workflow-permissions` declared the size of its
JUSTIFIED_WRITE_SCOPES table — a static declaration that keeps an entry for a workflow which has since
been deleted, while the loop that reads them SKIPS those. So the line reported a number larger than
what was examined: the exact shape the `::examined::` line exists to expose, committed by the change
that introduced the line.

Measured rather than argued: with one declared workflow removed from disk, the corrected form reports
**5** and the table-size form reports **6**. It now counts what was read from disk, and three cases pin
it — the count, a legitimate zero, and that a module-level holder is RESET so it cannot carry a
previous run's number into a run that read nothing. All three red-proved.

The lesson generalises to the remaining migration: the number must come from the walk, never from the
configuration the walk consults. A declaration and a subject are different things, and the whole point
of this invariant is the difference between them.

### Migration, batch 2 — 23 → 36 of 100

Thirteen more scans state the size of their subject: shell scripts, test-named package scripts,
active task files, documentation code blocks, repo-relative links, source files, packages with a
build contract, vitest configurations, harness scripts, planning documents, agent definitions,
declared hook events, and the changed documents `document-authority` judges.

**Two design points this batch settled, both learned by breaking something.**

`check-build-output-contracts` has a renderer whose exact lines a case asserts. Folding the marker
into it turned a suite-wide invariant into a change to a sentence, and the case went red on arrival.
The marker is emitted at the CALL SITE for that scan and for `document-authority`, whose
`reportFindings` is a pinned unit-test seam. **A verdict is prose for a human; the marker is a
channel for the runner, and the two do not share a line.**

`document-authority` produced the first legitimate zero of the migration: its subject is the DIFF,
so a diff carrying no document is a correct empty subject rather than a sweep that found nothing.
Undeclared it would have failed the suite — the invariant working — and the `::expected-empty::`
declaration is what tells the two apart. The suite summary now reads
`99 scans passed, 1 skipped`, which is the distinction this item exists to make visible.

Where the count did not reach `main`, the module-level holder the memory-mirror scan modelled was
used, RESET at the top of the walk so a run that reads nothing cannot report the previous run's
number.

### The same defect, a second time, in batch 2 — and this is the migration's most useful datum

`document-authority`'s marker declared `changedFiles.length`: every path in the diff, while the scan
examines only the markdown among them that exists on disk. On the batch's own fifteen-file diff
carrying one document it declared **fifteen**. Review caught it.

The lesson it violates — _the number must come from the walk, never from the configuration the walk
consults_ — was already written in this document, three sections above, by the change that learned it
the first time. Writing it down did not prevent the recurrence; the review did.

It also broke the legitimate zero it had been added for: a diff with no markdown but some other file
never reaches the zero branch, so it declares a healthy count over a walk that read nothing — the
state this invariant exists to make impossible, wearing the number that hides it.

**What the remaining 64 should take from it.** The trap is not carelessness about which variable to
print; it is that the plausible variable is usually in scope and the real one usually is not. The
input is at hand at the top of the function. The subject is only known after the filtering, the
existence checks and the skips — which is to say, after the walk. Every remaining scan should be
marked from a counter incremented at the point of examination, never from the collection handed in.

### Migration, batch 3 — 36 → 43 of 100

Seven more: ADR documents, specification documents, architecture-map documents, spec documents,
workflow files, agent definitions, review artifacts.

**The batch-2 lesson held, and cost nothing this time.** Every one of these was marked from a counter
incremented at the point of examination — the `readFileSync` inside the walk — never from the
collection handed in. The one scan that already had its number at the print site
(`action-references`, which counts the workflow sources it parsed) took a single line; the rest took
a module-level holder each, which is the shape the item predicted and the size it predicted.

### Migration, batch 4 — 43 → 47 of 100

Spec documents, transport source files, source files under the neutrality sweep, and workflow files.

**One placement defect, caught by running it.** The marker for `review-token-supply` first went
inside the failure arm, so it would have been absent from every passing run — and every run this
scan has ever had is a passing one, meaning the line would have looked present in the source and
never once appeared in the output. It is emitted before the branch now. The general form: a size is
reported whichever way the verdict goes, because the verdict is not what the size is about.

### What remains

**53 of 100 scans still declare nothing.** The ratchet makes the migration visible and irreversible;
this item stays open until it is done, and the baseline number is the progress bar.

## Done when

- A scan that examines nothing fails the suite, proven RED by pointing a real scan at an empty root.
- A scan with a declared expected-empty subject passes, proven GREEN, and its declaration fails when
  the subject stops being empty.
- The suite summary distinguishes examined-and-clean from examined-nothing, so `all N scans passed`
  stops being weaker than it reads.
- Applied to every registered scan, not to a sample — the count reported must be checkable against
  the workspace for the enumerating ones.
