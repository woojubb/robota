---
title: 'PROC-005: a documentation finding can be foundational, and doc-fixer has no correct local fix for one'
status: todo
priority: medium
urgency: soon
type: PROC
area: .claude/agents
created: 2026-08-01
depends_on: []
issue: https://github.com/woojubb/robota/issues/1545
---

# PROC-005 — the one caller of the depth verdict that needs a different answer

## Problem

`finding-depth-triager` is now dispatched from every place a finding is acted on — the PR review loop, the
architecture fixer and implementer, the CI triager, the human-invoked review, and the lesson loop — with one
deliberate omission: `doc-fixer`.

The omission is not an oversight, it is an unanswered question. A recurring documentation finding usually
means the CODE moved and the document is the symptom. `doc-fixer` edits documentation only, so for a
foundational doc finding there is **no correct local fix at all**: correcting the document makes it describe
a wrong design faithfully, which is the wrong design written down twice, and now with an accurate-looking
document defending it.

## Why it is not simply wired like the others

The other callers have somewhere to send a FOUNDATIONAL verdict — the fixer reports it unfixed, the
orchestrator routes it to a root item. `documentation-refresh` converges on `ACTIONABLE FINDINGS: 0`, so a
doc finding that is correctly left unfixed would keep the loop from converging unless the loop learns the
difference. That is a change to the orchestrator's convergence condition, not a clause in the worker.

## Questions to answer

1. Does `documentation-refresh` converge on "fixed" or on "resolved", and what does a labelled containment
   look like in a document? (In code it is a comment naming the root item; a document has no equivalent
   convention yet.)
2. Is a doc finding whose cause is in the code ALWAYS foundational, or only when the document's claim is one
   the design should not make?
3. Who files the root item — `doc-fixer` cannot, and the architecture pipeline may already own it.

## Done when

- `doc-fixer` takes a `DEPTH:` verdict and has a defined action for FOUNDATIONAL that is not "edit the doc".
- `documentation-refresh` converges with such a finding outstanding, without either looping forever or
  silently counting it as fixed.
