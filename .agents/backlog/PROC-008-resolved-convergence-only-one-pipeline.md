---
title: 'PROC-008: RESOLVED convergence and the containment note are declared repo-wide, and one pipeline implements them'
status: todo
priority: medium
urgency: soon
type: PROC
area: .agents/skills
created: 2026-08-01
depends_on: []
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
