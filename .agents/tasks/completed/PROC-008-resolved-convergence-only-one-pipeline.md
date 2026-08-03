---
title: 'PROC-008: RESOLVED convergence and the containment note are declared repo-wide, and one pipeline implements them'
status: done
priority: medium
urgency: soon
type: PROC
area: .agents/skills
created: 2026-08-01
completed: 2026-08-01
depends_on: []
issue: https://github.com/woojubb/robota/issues/1570
---

# PROC-008 — a rule stated for every loop, adopted by one

## Problem

[finding-depth.md](../rules/finding-depth.md) now states two things as general properties:

- an audit loop converges on RESOLVED (fixed / contained / INVALID), not on FIXED; and
- containment in a document is a **containment note** at the site, "one convention rather than one per
  pipeline".

PROC-005 brought `documentation-refresh`, `doc-auditor` and `doc-fixer` onto both. `architecture-refresh`
is on neither: it still converges on "no material findings in any area" (its own step 2), routes a
FOUNDATIONAL finding to the root item with no label at the site, and its map row still reads `auto → 0`.
Neither `architecture-auditor` nor `architecture-conformance-auditor` knows what a containment note is,
so a note written in an architecture document is re-raised as a finding by the other pipeline and the
two loops disagree about the same claim.

A rule that only one of its consumers implements is the shape this repository keeps measuring: the
statement reads as governing, and the second consumer is unaffected by it.

## Why it is not fixed where it surfaced

PROC-005's file ownership excluded `architecture-refresh` and the architecture agents (a concurrent
agent held them). Editing them from that change would also have been the wrong size: adopting a
convergence condition is a decision per pipeline, and the architecture loop has a second question
PROC-005 did not answer — whether a code-side finding contained in a DOCUMENT is a coherent state at all,
given that pipeline can change the code.

## Done when

- `architecture-refresh` states its convergence in the same vocabulary, or the rule is narrowed with the
  reason this pipeline is exempt.
- Both architecture auditors read a containment note, or the convention is scoped to the documents that
  do.
- `.agents/rules/finding-depth.md`'s pointer to this item is removed with the fix, and
  `.agents/specs/orchestration-map.md`'s Architecture refresh loop-back cell matches whatever is decided.

## Resolution (2026-08-01)

### Measured, not asserted

The item names `architecture-refresh`. Asking the question mechanically — which pipelines end on a
findings count AND carry a depth verdict, derived from the orchestration map rather than remembered —
found a third:

| Pipeline                     | Converged on RESOLVED | Guardians reading the containment label                             |
| ---------------------------- | --------------------- | ------------------------------------------------------------------- |
| `documentation-refresh`      | yes                   | `doc-auditor` — yes                                                 |
| `architecture-refresh`       | **no** (`auto → 0`)   | `architecture-auditor`, `architecture-conformance-auditor` — **no** |
| `pr-finding-resolution-loop` | **no** (`auto → 0`)   | `pr-review-reviewer` — **no**                                       |

**1 of 3 pipelines and 1 of 4 counting guardians before; 3 of 3 and 4 of 4 after.** `pr-finding-resolution-loop`
was not in the item's statement and is the same defect: it routes a foundational finding to a labelled
containment and then converges on a count produced by a reviewer that does not know what the label is, so
the only way that round reaches zero is by patching the wrong layer. Fixing the two the item named and
leaving the third would have reproduced the item inside its own fix.

`delegated-refactor-green-gate` converges on a findings count and has NO depth step at all. That is a
different gap, deliberately out of scope here rather than silently folded in.

### The question the item left open

Is a code-side finding contained in a DOCUMENT coherent, given the architecture pipeline can change code?
The answer is that containment takes the form of the artifact the hold is IN — the note in a document, the
comment in code — and both now open `Contained — <ID>.`, so one reader serves both. That a pipeline CAN
reach the code does not make a foundational finding an implementation task: depth is about where the defect
is, and reaching it is exactly what turns a foundational finding into a patch on the wrong layer.

### Floor

Extends `depth-verdict-reachable.test.mjs` (which already owns "finding-depth.md's clauses are reached")
with cases that DERIVE the consumers from the map, so the rule's reach is computed rather than listed in
prose that goes stale on the next pipeline. Per pipeline: the map's Loop-back cell says resolved, the
orchestrator's own body states the three dispositions, and every guardian in the row declaring
`ACTIONABLE FINDINGS` names the label. Red proof: all four cases fail on the pre-fix tree, naming
`architecture-auditor`, `architecture-conformance-auditor` and `pr-review-reviewer`; the body half fails
independently of the map cell.
