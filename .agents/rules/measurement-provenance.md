# Measurement Provenance — a reported size comes from the work it describes

Mandatory. Parent: [index.md](index.md) § Process Sub-Rules. Mechanized by
`scripts/harness/scan-measurement-provenance.mjs`, registered as `measurement-provenance`.

A check that reports how much it examined is making a claim about its own coverage, and that number is
the only part of the claim a reader can act on — nothing downstream re-derives it. A number taken from
somewhere other than the work describes something else, and it fails in one direction: it reads larger
and steadier than the coverage it stands for, so the check looks most trustworthy at the moment it has
stopped being so.

## The rule

**1. The number is produced by the traversal that does the work.** It is incremented where the work
happens. A size read off a collection of results, a configuration entry, a static table, or any second
source that merely resembles the subject is the size of that other thing. The two agree until the day
they diverge, which is the day the number was needed — and a collection additionally loses every
duplicate, so it under-reports precisely where the subject is densest.

**2. One subject, one number.** A check that walks two populations reports two. A single figure over
both cannot shrink visibly: whichever walk collapses is absorbed by the other, and the total still
reads as coverage.

**3. The counter is an output, and is tested as one.** Two cases, and neither substitutes for the
other:

- an **exact** expected value against a fixture of known size — a lower bound is satisfied by every
  over-count, including one that counts the same subject twice;
- an assertion taken **after a second run**, proving the counter starts from zero. A counter that
  accumulates reports the sum of every run in the process and rises monotonically, which is
  indistinguishable from a subject that is growing. The ORDER is the property, not the fixture: an
  assertion taken before the second run describes the first one and holds either way. Vary the second
  input when clause 1 is what is in doubt — a number read off a second source diverges from the walk
  only where the two disagree in size.

## Scope

This governs any quantity a check publishes **about itself** — files walked, records validated, entries
compared. It does not govern a domain value computed for a caller; that is the output, and it is tested
because it is the output. The distinction is who reads the number and what they conclude from it: a
self-reported size is read as evidence that the check ran over what it names.

## What is mechanical

`measurement-provenance` derives its subjects from the tree — every check whose source emits the
declaration — and fails one whose counter is not exported, whose value no exact numeric
assertion reads, or which has no assertion after a second run. Clauses 1 and 2 are judgement: where a
number was incremented is not decidable from outside the module, and a counter carrying the cases
above is one whose provenance someone had to establish in order to write them.

**The floor's own coverage is a number it publishes, not a claim it implies.** Every subject is
classified as covered or unmet, a subject in neither is a finding, and both lists are re-measured on
every run — so an entry that comes to meet the floor is a finding, and one that stops meeting it is a
regression rather than a quiet move to the debt list. A pass therefore says how many subjects are
covered; it never says that every declared size is checked.
