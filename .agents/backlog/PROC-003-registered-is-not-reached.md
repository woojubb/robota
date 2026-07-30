---
title: 'PROC-003: "registered" is not "reached" — the audit that found it, and what it means for how guards are written'
status: todo
priority: high
urgency: soon
type: INFRA
area: .agents/rules
created: 2026-07-28
depends_on: [INFRA-066, INFRA-067, INFRA-068, HARNESS-057, HARNESS-061]
---

# PROC-003 — the finding four independent audits converged on

## What was measured

A four-way audit ran on 2026-07-27/28 after the owner's observation that work was repeatedly done
and then undone, and that the same problems kept erupting. Scopes were split so the passes could not
contaminate each other: hook reachability, rules-versus-enforcement, scan reachability, and
recurrence mining.

They converged on one defect, and it is not a bug:

> **Enforcement exists, is registered, and does not fire.**

| Measurement                                                                  | Value      |
| ---------------------------------------------------------------------------- | ---------- |
| Normative obligations in `.agents/rules/**`                                  | 292        |
| …naming no mechanism at all                                                  | **232**    |
| …whose mechanism is unreachable                                              | 8          |
| …whose mechanism is reachable but scoped so violations pass                  | 6          |
| …**proven to fire by execution**                                             | **2**      |
| Commits in the last 7 days that are harness/CI self-repair                   | 146 of 529 |
| Touches to `run-all-scans.mjs` in 10 days                                    | 53         |
| Touches to `scan-guard-scope-fail-closed.mjs` — the guard for vacuous guards | 27         |

The strongest evidence is the convergence itself: two passes with no shared scope independently
landed on "registered but unreachable" as the dominant class.

## The three shapes, so they are recognisable before they are written

1. **Unreachable matcher.** A guard matched commands with a `^`-anchor while every real command
   begins with `cd <repo>`. Every push in a long session bypassed it silently. `branch-guard.sh`
   carried the same anchor on all five verbs it detects — so its branch-create check had never once
   fired on a real branch creation, which is how a branch was cut from a promotion branch and broke
   the promotion-ancestry gate.
2. **Condition supplied by the test, not by the deployment.** `worktree-cwd-guard.sh` fails open
   unless a variable that exists **only in its own test file** is set. Ten green tests over a guard
   that is off in every real session.
3. **Named but never called.** `verify-like-ci` is described as the CI-equivalent entry point and is
   invoked by nothing. `pnpm harness:verify:release` reproduces `protect-main`'s required gate, is
   named in a comment, and was never run before promoting — two promotions failed on it.

## What this changes about writing a guard

Three questions, in this order. The repository already asks the first two; the third is what this
audit added.

1. **Can it fail?** (`scan-main-required-checks`, INFRA-055)
2. **Does it check the right thing?** (`.agents/memory/check-validity-two-axes.md`)
3. **Is it reached — by the real invocation, in the real environment?**

A test that supplies the condition, an entry point nothing calls, and a matcher no real command hits
all pass 1 and 2 and fail 3.

## Done when

- The three questions are in `.agents/rules/enforcement-architecture.md` as the contract for adding
  a guard, alongside the existing "every guardian has a mechanical floor" claim — which is precisely
  what `.claude/hooks/` did not have.
- A new guard cannot land without a case that runs it as a real invocation would, with only the
  environment a real session has.
- The child items are closed or consciously deferred, and this item states which.

## Not to be filed again

`#1510` and `#1514` already close the anchoring class for hooks, and `#1513` makes three scans'
findings visible. Two audit passes proposed items for those; they are struck rather than duplicated.

## Progress (2026-07-30)

**Criterion 1 — the three questions are in the rule: DONE.** `enforcement-architecture.md` now
carries them as the contract for adding a guard, with the three measured failures that produced the
third one (`pre-push-check`'s `^` anchor, `worktree-cwd-guard`'s unexported marker, `verify-like-ci`'s
absent caller).

**Criterion 2 — a new guard cannot land without a case that runs it: PARTLY DONE, and the part that
is mechanical is stated.** `hooks-have-execution-coverage` fails when any `.claude/hooks/*.sh` is
executed by no test. It found four on its first run — `memory-mirror-reminder`, `post-tool-format`,
`spec-first-gate`, `task-tracking` — described by nothing and run by nothing; all four now have
execution cases, and giving `post-tool-format` its first one immediately surfaced a `set -u` crash on
an unset `CLAUDE_PROJECT_DIR`.

What the floor deliberately does not claim is the harder half: that the environment a case supplies
is one a real session supplies. `worktree-cwd-guard` passed ten tests that ran it — with a marker
only those tests set. The rule asks each case to state which signal it depends on and who sends it,
and that remains judgement rather than a check.

**Criterion 3 — child items closed or consciously deferred:**

| Child                                                | State                                                   |
| ---------------------------------------------------- | ------------------------------------------------------- |
| INFRA-067 (branch base at creation)                  | closed 2026-07-30                                       |
| INFRA-068 (worktree guard dead)                      | closed 2026-07-30                                       |
| HARNESS-061 (hooks see part of the command)          | closed 2026-07-30                                       |
| INFRA-066 (required checks runnable locally)         | OPEN — the ruleset-declaration mechanism does not exist |
| HARNESS-057 (a scan reports the size of its subject) | OPEN                                                    |

This item stays open on INFRA-066 and HARNESS-057, and on the judgement half of criterion 2.
