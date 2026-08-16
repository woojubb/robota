---
title: 'AGREEMENT-003: close the self-judgement failure class — six times in one session a role judged its own output, every one caught by an independent reviewer and never by the producer, in areas where enforcement-architecture.md already forbids it'
status: todo
created: 2026-08-16
priority: high
urgency: now
area: cross-cutting harness governance initiative
depends_on: []
children: [HARNESS-097, HARNESS-098, HARNESS-099, HARNESS-100]
---

# AGREEMENT-003: the self-judgement failure class

Converted from [issue #1763](https://github.com/woojubb/robota/issues/1763) — owner directives from
the 2026-08-16 session, filed as an issue so the work then in flight was not disturbed. This document
is that issue's conversion, and the conversion is itself one of the capabilities the issue asks for
(HARNESS-100).

## Objective

The issue's own diagnosis is the objective:

> Six times in one session the same failure recurred: I judged my own output. Every one was caught by
> an independent reviewer, never by me. The repo's `enforcement-architecture.md` already forbids a
> role that both produces and judges — the skills below apply that to areas where it currently is not
> applied.

So this is not a request for new policy. `enforcement-architecture.md:21` already says _"A skill/agent
that both produces and judges, or that judges and also routes, violates this rule. Split it."_ The
initiative is to apply an existing rule to four places it does not reach.

## Why four children, not one item or eight

The issue lists eight skills. They are not eight causes — grouping them by cause gives four, and the
issue itself makes two of the groupings:

| Child           | Cause                                                                     | Issue items                                                         |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **HARNESS-097** | A contract's state judged from a proxy signal instead of its actual state | 1, 2 — _"Both this and #1 are the same root error"_ (issue's words) |
| **HARNESS-098** | A verification whose verdict is not a function of the condition it names  | 3                                                                   |
| **HARNESS-099** | Wiring performed and judged by the same role                              | 4, 5, 6 — one trio                                                  |
| **HARNESS-100** | Mid-task discovery has no filing path that leaves the work undisturbed    | 7, 8 — _"Two skills, because they run at different times"_          |

Splitting by cause rather than by skill count is deliberate, and this session paid to learn it: an
adjacent item's `area` grew from 3 packages to 13 across twelve review rounds because each verified
finding was absorbed rather than routed to its owner. `finding-depth.md` owns that distinction. Four
children with one cause each are independently verifiable; one item with eight skills is not.

## Children

- [ ] HARNESS-097 — todo — `.agents/tasks/HARNESS-097-contract-state-judged-by-proxy-signal.md`
- [ ] HARNESS-098 — todo — `.agents/tasks/HARNESS-098-verifications-that-cannot-fail-or-cannot-pass.md`
- [ ] HARNESS-099 — todo — `.agents/tasks/HARNESS-099-wiring-is-performed-and-judged-by-the-same-role.md`
- [ ] HARNESS-100 — todo — `.agents/tasks/HARNESS-100-mid-task-discovery-has-no-filing-path-that-does-not-disturb-the-work.md`

## Plan

No hard ordering between the children — none blocks another. Two couplings to respect:

1. **HARNESS-099 depends on HARNESS-098's standard being right**, not on its delivery. The wiring
   guardian's second half ("would the registration check have gone red had it not been wired?") is
   itself a falsifiability requirement; if HARNESS-098 settles what that means first, HARNESS-099
   inherits it instead of inventing a second answer.
2. **HARNESS-100 is the meta-item** — the path by which the other three were filed. Its worked
   example is this conversion, so it can be written from evidence that already exists.

Cheapest first if a sequence is wanted: HARNESS-100 (documents what just happened), HARNESS-098
(sets the falsifiability bar), HARNESS-099 (consumes it), HARNESS-097 (needs the most design, since
its mechanism must read npm state).

## Constraints (from the issue, non-negotiable)

- **Wire fully or not at all** — no partial wiring (`lesson-to-harness` step 6).
- **Each child needs a mechanical prevention**, or a written concrete obstacle plus a tracked item
  (step 8). "Hard to check" / "low value" / silence are not acceptable.
- **Prove each mechanism catches its incident** — run it against the pre-fix state and confirm it
  FAILS (step 9). For this initiative that step is load-bearing rather than ceremonial: HARNESS-098
  is _about_ checks that cannot fail, so a mechanism shipped without its red proof would be the
  initiative committing the defect it exists to close.

## Findings from the conversion

Recorded here because a later session would otherwise re-derive them:

- **A skill named `contract-audit` already exists** (`.agents/skills/contract-audit/`) and is about a
  package's SPEC.md Class Contract Registry — interface implementations, inheritance chains,
  cross-package port consumers. It is **not** what the issue means by "contract audit". Whatever
  HARNESS-097 builds must not reuse that name, and the two must be distinguishable from their
  descriptions alone.
- **The mirror of the unfalsifiable check is already filed separately** as
  [issue #1765](https://github.com/woojubb/robota/issues/1765) (the spec public-surface parser that
  cannot PASS on correct input). HARNESS-098 covers both directions; #1765 is the concrete instance.

## Test Plan

Per-child, in each child document. At the initiative level: every child reaches a **named terminal
state** for its mechanism (mechanized, or infeasible-now with obstacle + tracked item), and the
prove-it-fails result is recorded for each. `lesson-to-harness` step 11: no named terminal state means
the lesson is not closed.

## User Execution Test Scenarios

Not applicable — this initiative is harness governance with no runnable user-facing behaviour. Per the
Task README, governance-only changes record `Not applicable` with the reason and keep verification in
the Test Plan. Each child states the same, with its mechanism's before/after result as the evidence.
