---
id: PROC-002
title: Provisional slugs during development, a unique slug issued at merge
status: todo
priority: medium
urgency: later
type: INFRA
created: 2026-07-26
area: .agents/tasks, .agents/spec-docs, .agents/rules/backlog-execution.md
depends_on: []
---

# PROC-002: issue the identifier at merge, not at authoring time

## Owner decision

Work in progress uses a **provisional, non-colliding slug**. The unique slug is **issued when the
work merges**. This item designs and implements that.

## The problem it solves

Today an author picks the ID and slug at authoring time, before anyone knows whether the work will
land, and two authors working in parallel cannot see each other's choice. Measured on this
repository:

- Two concurrent PRs from the same audit both filed `ARCH-006` and `ARCH-007` under different slugs
  (2026-07-25).
- A new `DIST-002-release-artifact-verification` was filed while
  `.agents/spec-docs/done/DIST-002-bun-binary-release-workflow.md` already held that number
  (2026-07-26) — a _retired_ number reused, which no existing check saw.

Both are the same shape: **the identifier is claimed early, against a namespace the author cannot
observe atomically.** Branch-local files make the collision invisible until merge, which is exactly
when it is most expensive to fix — references, links and cross-item citations have all been written
against the wrong number.

## Why a slug-equality check is the wrong answer, measured

The obvious guard — require a backlog item and its spec-doc to share a slug — is **noise**. Of the
111 IDs that currently appear in both `.agents/tasks/` and `.agents/spec-docs/`, **34 have
mismatched slugs, and almost all are the same item reworded**: `cjk-ime-defer-submit` versus
`ime-last-character-drop`, `context-tracker-accurate-estimate` versus
`hash-based-context-file-staleness-detection`. A guard firing 34 times on correct data gets
suppressed, and a suppressed guard costs more than the collisions it would have caught. (That
reasoning is the same one `review-gate`'s severity split rests on.)

So the fix is not a stricter check on the current scheme. It is to **stop requiring the author to
guess a unique identifier at all.**

## Direction

The shape the owner specified:

1. **Provisional identifier while in flight.** Something guaranteed not to collide without consulting
   a shared registry — derived from the branch name, a timestamp, or a random token. It must be
   obviously provisional on sight, so nobody cites it as though it were permanent.
2. **Unique slug issued at merge.** The number is allocated when the work lands, from the live state
   of the namespace, at the one moment it can be read atomically.
3. **References updated as part of that issuance**, or the scheme must avoid creating references to
   the provisional form in the first place. This is the hard part and deserves the most design
   attention: cross-item citations are the reason a late rename is expensive today.

Open questions worth settling before implementing:

- Does the spec-doc pipeline (`draft → backlog → todo → active → done`) allocate at the same moment,
  or does it inherit the backlog item's issued number?
- What happens to a branch that sits unmerged for weeks — does its provisional identifier expire?
- Is the issuance mechanical (a script run at merge, a CI step) or a convention? A convention will
  drift; this repo has repeatedly found that prose without a mechanism does not hold.

## What already exists, and what it does NOT do

`scripts/harness/check-backlog-placement.mjs` gained a narrow rule on 2026-07-26: a backlog file may
not be the **first** to claim an ID that `.agents/spec-docs/` has already spent. It fires on zero
current items and caught the `DIST-002` reuse when reproduced.

It deliberately does **not** check slug equality, and it does not prevent two in-flight branches from
claiming the same free number — that collision is only visible once both merge. **This item
supersedes the need for that guard**; the guard is a stopgap for the current scheme, not a design.

## Acceptance

- [ ] A provisional-identifier scheme that cannot collide across concurrent branches.
- [ ] Issuance at merge, mechanical rather than conventional.
- [ ] The reference-update problem answered — either solved, or avoided by construction.
- [ ] Proven against the two real collisions above: replay each and show the scheme prevents it.

## References

- `scripts/harness/check-backlog-placement.mjs` — the stopgap guard and its reasoning
- `.agents/tasks/README.md` — current authoring convention
- `.agents/rules/backlog-execution.md` § Status Invariants
