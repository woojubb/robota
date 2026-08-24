---
title: "PROC-015: an issue's resolution is delegated to a host feature that never fires on the integration branch"
issue: https://github.com/woojubb/robota/issues/2289
status: in-progress
created: 2026-08-24
priority: medium
urgency: soon
area: .agents/rules, .agents/skills
depends_on: []
---

# PROC-015: an issue's resolution is delegated to a host feature that never fires on the integration branch

## Objective

Make the closure of an issue an explicit act by the session that delivered it, at the moment the work
reaches `develop` — instead of an inference the host draws from a keyword on a pull request that does not
target the branch the keyword needs.

## The measurement this rests on

`scripts/harness/promotion-closes.mjs` records the mechanism: GitHub's closing keywords fire only on a
pull request whose base is the **default branch**. Every feature pull request in this repository targets
`develop`, so no merge into `develop` has ever closed an issue.

Measured on 2026-08-24 over the 120 most recent merged `develop` pull requests:

| Measurement                                                   | Count |
| ------------------------------------------------------------- | ----- |
| body-level closing keywords (`closes` / `fixes` / `resolves`) | 87    |
| of those, the named issue still open                          | 2     |
| open issues merely _mentioned_ by a merged pull request       | 57    |
| of those 57, the mention is a delivery rather than a filing   | ~0    |

The last row is the one that matters, and it is why this Task does not propose a batch closure. The
mention text is overwhelmingly `filed as #N`, `parent tracker #N`, `Filed from this: #N` — a merged pull
request naming an issue is usually **registering future work**, not delivering it. A mechanism that closed
every mentioned issue would close the backlog this repository had just written down.

## Why a keyword cannot carry the judgement

A keyword closes an issue **whole**. A pull request that delivers part of an issue therefore has two
options, and both are wrong: carry the keyword and close undelivered acceptance criteria along with the
delivered ones, or omit it and close nothing. Observed the same day on issue #2024, whose five acceptance
criteria were delivered three-and-a-half by one pull request — had that pull request carried `Closes`, two
undelivered criteria would have closed with it.

An explicit step can close what was delivered **and say what was not**. That is the judgement the keyword
has no way to express, and it is the reason this is a step and not a better-configured feature.

## Plan

- [x] Amend `.agents/rules/git-branch.md` — `develop` is where resolution happens, and the closure is
      performed, not inferred.
- [x] Add the closure step to the `post-merge-cycle` skill, positioned after the landing verdict and
      before branch deletion.
- [x] State the enforcement honestly, including what no machine can decide.
- [x] Amend `.agents/rules/backlog-execution.md` — registration is not authorization; an item may be
      declined with reasons, and a decline is closed rather than left open.

## The second half: an open item is not an instruction

Added to this Task on the owner's direction the same day, because it shares a cause with the first half.
Closing an issue when work lands only helps if the queue is a list of things worth doing. Issues reach
this repository through routes that do not share a bar — an audit sweep, a review finding filed rather
than absorbed, a scan's output, an observation made during unrelated work. If every registered item must
be worked, the cheapest route to create work sets the queue, and the cost of filing something trivial is
paid by whoever picks it up.

So picking an item up begins with a judgement that may go either way, and a decline is **closed** with
its grounds written on the issue. Left open, a declined item stays in every count and is re-judged from
scratch by the next session — the state this repository was already in.

One asymmetry is written into the rule rather than left to taste: an item asserting a security or
data-correctness defect is not declined on agent authority. "I could not reproduce it" and "it does not
happen" are different claims, and only the second one is a disposition.

## Test Plan

- `pnpm harness:scan` — `new-rule-declares-enforcement` must accept the new rule section, and
  `conflict-markers` must not report the new text as contradicting the promotion rule (they describe two
  different acts and must read as such).
- `pnpm harness:verify-like-ci` for the repository-wide gates.
- Falsification: a rule section without its `Enforced by:` line must be REFUSED by the scan. Recorded as
  a control arm so the scan's acceptance of the real section is not a vacuous green.

## User Execution Test Scenarios

Not applicable — a rule-and-skill change delivering no runnable user-facing behavior. The document checks
belong to the Test Plan above, per `.agents/tasks/README.md`.
