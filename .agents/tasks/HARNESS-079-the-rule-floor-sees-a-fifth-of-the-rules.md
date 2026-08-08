---
title: 'HARNESS-079: the new-rule enforcement floor sees roughly a fifth of the rules that exist'
status: todo
created: 2026-08-08
priority: medium
urgency: soon
area: scripts/harness, .agents/rules
depends_on: []
---

# HARNESS-079 — the rule floor sees a fifth of the rules

**Source:** review finding on PR #1647

## The problem

`scan-new-rule-declares-enforcement` asks a newly-added rule to say how it is enforced. It decides
"is this bullet a rule" with a closed keyword list:

```
MUST | MUST NOT | NEVER | ALWAYS | PROHIBITED | REQUIRED | is banned | is forbidden
```

A rule phrased without one of those exact words is invisible: it opens no section, so the floor
never asks it for a declaration. It does not report it — it does not see it.

**That enumeration fails SILENTLY**, which is the direction this repository forbids everywhere else.
Its sibling checks say so in their own headers (`fail-direction: refuse`) precisely because a
missing entry there costs a visible refusal; here it costs a pass nobody sees.

## Measured

Over `.agents/rules/`, 2026-08-08:

|                                             | count |
| ------------------------------------------- | ----- |
| bullets the pattern MATCHES                 | 29    |
| bullets carrying a normative word it MISSES | 104   |

Examples of the miss, all real rules:

- `- Do not combine unrelated backlogs in one PR.`
- `- Every PR description must include the accepted recommendation, its REVIEW VERDICT, …`
- `- **Never silently, either way.** If the principle wins, the amendment is filed …`
- `- A valid user execution test scenario must use a product surface.`

## Why it is not a one-line widen

Those 104 are rules. Admitting them makes this floor RED on every rules edit until each carries an
`Enforced by:` declaration — a migration, not an edit. Widening the pattern inside an unrelated PR
would either land it half-done or hold that PR for the whole migration.

Lowercase `must` is also common in explanatory prose, so a naive widen fires on sentences that
describe a rule rather than state one. That is the reason the list was narrow originally, and it is
still a real constraint on how the widening is done.

## What a fix has to do

1. Decide the recognition rule. Two candidates worth measuring rather than choosing on taste:
   - **Widen the keywords** and declare the 104 in one sweep. Honest, large, and leaves the same
     shape — a closed list that fails silently — one notch wider.
   - **Invert it**: every added bullet under a `.agents/rules/` heading is a rule unless it carries
     an explicit `not-a-rule:` marker. Fails LOUDLY, which is the direction the repo wants, at the
     cost of a marker on genuinely explanatory bullets.
2. Whichever is chosen, the sweep lands with it — a floor that is red on arrival teaches people to
   bypass it.

## Acceptance

The scan's header states its fail direction with the post-fix number; no rule in `.agents/rules/`
is invisible to the recognition rule without an explicit marker; the floor is green on the tree it
ships with.
