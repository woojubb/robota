---
title: 'HARNESS-068: the one-owner rule is enforced by a scan, and the second copy of the list sits just outside its reach'
status: todo
created: 2026-08-02
priority: medium
urgency: next
area: scripts/harness, CONTRIBUTING.md
depends_on: []
---

# HARNESS-068: where a rule has a mechanism, the mechanism's edge is the blind spot

## Problem

`AGENTS.md` states the rule:

> **"Never duplicate content across levels. Each fact has exactly one owner document."**

`.agents/project-structure.md` claims ownership of the package list, and
`check-dependency-direction.mjs` Rule 9 enforces it — a package name in that document's prose that
does not exist fails the build.

`CONTRIBUTING.md` carries a second copy of the same list (**8 `- \`packages/…\`** entries, verified),
and nothing checks it.

So the repo holds the rule, holds a mechanism for the rule, violates the rule in its own root
document, and the mechanism's scope stops one file short.

## Evidence

Raised by an external read-only investigation (2026-08-02); the count and the scan's scope were
re-verified here.

The general point is worth more than the instance: **once a rule acquires a mechanical check, the
check's scope becomes the boundary of the rule.** Anything outside it is not merely unchecked — it is
unchecked _while the rule reads as enforced_, which is more misleading than having no check at all.
That is the same shape as HARNESS-064 (vacuity) and HARNESS-067 (non-neutrality's silent pass): the
green is about narrower ground than the reader assumes.

## Why this is foundational (or not)

**LOCAL.** One file, one list. Filed because the class is worth a mechanism, not because the instance
is costly.

## Direction

Two admissible answers, and the second is better:

1. Extend `check-dependency-direction.mjs` Rule 9's scope to `CONTRIBUTING.md`.
2. Delete the list from `CONTRIBUTING.md` and link to `.agents/project-structure.md`.

The second obeys the rule instead of enforcing it in two places, and leaves nothing to drift. Option
1 keeps two copies and makes a scan responsible for their agreement, which is the arrangement the
one-owner rule exists to avoid.

Worth checking while here: whether any OTHER root document carries a third copy. The instance was
found by reading, not by a sweep, so the count of copies is unknown.

## Test Plan

- **Required red-first regression:** if the outcome is option 1, a package name in `CONTRIBUTING.md`
  that does not exist must FAIL the scan — proven red before the scan is trusted. If the outcome is
  option 2, the regression is that the list is gone: assert `CONTRIBUTING.md` contains no
  `packages/*` enumeration, which fails today.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Does not apply.** Documentation and repo tooling only.
