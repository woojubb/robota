---
title: 'HARNESS-097: a contract''s state is judged from a proxy signal instead of its actual state — "no consumer found" is read as dead, and "published" is read as unmodifiable, and both readings are made by the same agent that then acts on them'
status: todo
created: 2026-08-16
priority: high
urgency: now
area: .agents/rules, .agents/skills, scripts/harness
depends_on: []
---

# HARNESS-097: dead-by-grep and unmodifiable-by-assumption

Converted from [issue #1763](https://github.com/woojubb/robota/issues/1763) (owner directives,
2026-08-16 session), items **1 (contract audit)** and **2 (exposure gate)**. They are one item because
the issue states they share a root: _"Both this and #1 are the same root error — judging a contract by
a proxy signal instead of its actual state."_

## Problem

Two mirror-image errors, both made in one session, both from the same substitution:

| Proxy signal read          | Conclusion drawn            | What was actually true                                                    |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------- |
| `grep` finds no consumer   | "dead contract — remove it" | forward-provisioned, or the owner is wrong and it should be **relocated** |
| the surface is "published" | "we cannot change this"     | the project is pre-release beta; **nothing is externally exposed**        |

Both readings were then acted on by the agent that made them, with no independent check.

**The first rule already existed and was violated anyway.** `project-structure.md:225`: _"Removal of an
unconsumed public surface is a PRODUCT decision — never a grep-based cleanup. Propose it as a user
decision item with options; do not file it as 'dead code'."_ Prose alone did not hold, which is why
this needs a procedure **and** a mechanism rather than more prose.

**Measured instances (from the issue):**

- `branchName` deleted on a grep result; relocated after the owner corrected it.
- `providerProfile` labelled a "dead contract field" in a **shipped changeset**, when it is
  carried-but-not-honored — ARCH-021 is the item that honors it.
- The mirror: three of CORE-043's four "decisions reserved for the owner" were reserved because the
  surfaces were read as published contracts. They are not — 71 npm versions, zero non-prerelease.

## Direction

**The exposure gate is a mandatory step, not advice (owner directive).** Before any "we cannot change
this" judgement, verify the **actual current exposure state** and decide from that. Concretely
checkable here: npm dist-tags and whether any non-prerelease version exists.

**The disposition vocabulary is closed.** An unconsumed public contract has exactly three correct
dispositions, and "delete because grep found nothing" is not among them:

1. **Keep + document** as intentional forward provision;
2. **Relocate** if the owner is wrong;
3. **Remove** only by an explicit product decision.

**Naming collision to resolve first.** A skill named `contract-audit` **already exists**
(`.agents/skills/contract-audit/`) and is about something else entirely — a package's SPEC.md Class
Contract Registry, interface implementations and inheritance chains. Whatever this item builds must
not reuse that name, and the two must be distinguishable from their descriptions alone.

## Mechanism (required — see `lesson-to-harness` step 8)

Candidates, to be decided during design:

- A scan that fails a changeset or commit body asserting a contract is "dead"/"unused"/"removed as
  unused" without a recorded disposition from the closed vocabulary above.
- A scan that fails a document asserting a backward-compatibility constraint while the package's
  published versions are all prereleases — the exposure fact is mechanically derivable.

**Infeasible-now is a permitted terminal state only with a written concrete obstacle plus a tracked
item.** "Hard to check" is not a reason.

## Test Plan

- Prove-it-fails (step 9): run the mechanism against the two recorded instances' pre-fix state — the
  `providerProfile` changeset text and CORE-043's original "published contract" reservations — and
  confirm it FAILS, then against the corrected state and confirm it PASSES.
- Sweep (step 5): enumerate every current instance of both readings in the repo, not just the three
  recorded ones.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — harness/process change with no runnable user-facing behaviour. The mechanism's
before/after result under Test Plan is the evidence, per the Task README's rule for
governance-only changes.
