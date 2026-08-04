---
title: 'HARNESS-072: nothing detects a contradiction between two rules, only forbidden phrases inside one'
status: todo
issue: https://github.com/woojubb/robota/issues/1617
created: 2026-08-03
priority: high
urgency: next
area: .agents/rules, .agents/specs, scripts/harness
depends_on: []
---

# HARNESS-072: the conflict scan reads words, not claims

## Problem

Owner directive, 2026-08-03: **"규칙의 모순은 지속적으로 개선해 나가야 합니다"** — contradictions between
rules must be improved continuously, not fixed once when someone notices.

Nothing in the harness detects one. `scan-conflict-markers.mjs` — registered, named for exactly this —
searches harness prose for forbidden PHRASES (`fallback to`, `temporary workaround`, `sub-agent`). It
cannot see the case where document A states a normative claim and document B states its negation,
because both are written in permitted words.

That gap is not theoretical. PR #1615 produced **five** instances in one change, every one found by a
review round and none by a machine:

| Round     | Contradiction                                                   | Between                                                                                                |
| --------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 7         | the stopping condition of the PR-review loop                    | `.agents/memory/review-rounds-until-zero.md` vs the owning skill                                       |
| 8         | `bounded (max 3 + progress detection)`                          | `.agents/specs/orchestration-map.md` vs the same skill, after the cap was removed                      |
| 9, 10, 12 | `max 3 iterations` in three separate places                     | `.agents/spec-docs/draft/HARNESS-018-*.md` vs the same skill                                           |
| 13        | "bounded iterations, then escalate" — a count as the ONLY bound | `.agents/rules/research.md` vs `.agents/rules/enforcement-architecture.md`, which forbids exactly that |

The last is the sharpest: one MANDATORY rule contradicting another, in normative text, created by the
change that landed the second one. Rules outrank skills, so a reader following `research.md` would
have been correct to ignore the newer rule.

## Evidence

The structural cause is measurable. `.agents/specs/orchestration-map.md` states a loop-back bound for
every pipeline in its own words, and each owning skill states the same bound again:

```
| **Post-merge cycle**   | auto → bounded (2 base re-cuts); halt on a FAIL landing verdict …
| **Backlog execution**  | auto → bounded (2 recommendation revisions, 2 redesigns, 2 defect rounds) …
| **Delegated refactor** | auto → bounded (2 re-specifications, 2 re-verify rounds, 2 review rounds) …
| **Release**            | auto → bounded (2 re-runs/phase, 2 triages/signature, 3 OTP requests) …
```

Seven pipelines, two independent statements each — fourteen places a contradiction can open, and the
one that did was caught by a human reading two documents side by side. The map's header claims it is
"mechanically kept current"; `scan-orchestration-map.mjs` checks only that every agent file appears in
it, so the LOOP-BACK column has never been compared to anything.

## A third axis: a rule contradicting a universal principle

Owner directive, same day: **"보편적인 규칙이 더 중요합니다"** — a universal rule matters more than one we
wrote. If the review action argues from a universal engineering principle, that argument can take
priority and OUR rule may be the thing to amend.

The rule set had no clause admitting this. `AGENTS.md` called rules "mandatory, non-negotiable" and
the precedence chain ran `user instructions > RCP conduct > other harness rules > default behaviour` —
a well-founded universal principle appears nowhere in it, so by the letter, citing a harness rule was
always a valid refutation of a review finding. That is the same defect one level up: the rule set
treating itself as terminal.

Fixed in #1615 at the authority level — `agent-conduct.md` § "A local rule is an encoding" (with the narrow exceptions: rules encoding a repo-specific fact or an owner decision),
`rules/index.md` § "This rule set is not the end of the argument", and the judging step of
`automated-review-convergence`. What remains for this item is the MECHANISM, because the failure is
silent by nature:

- A refutation whose only content is a rule reference is detectable. The review ledger records a
  reason per finding; a reason that cites a rule and nothing about the call site is the shape to flag.
- The precedent this rests on is real and worth reusing: RCP is an external universal profile that
  already outranks harness rules for conduct. The chain has always admitted a general standard beating
  a local one; it was never extended to engineering.

## Progress — step 1 is mechanical, and the live instance below is resolved

`scan-loop-contract.mjs` (landed with HARNESS-071) makes the FIRST of the three Direction steps
mechanical, and it is the step that would have caught round 8 by machine.

Each pipeline's bound was written twice — once in the owning skill and once in this map's Loop-back
cell — which is fourteen places a contradiction can open. The bound is now DECLARED once, in the
skill's frontmatter, and the map's cell is checked against that declaration: it must mention progress
detection when the skill declares the escape, and must carry the skill's number when it declares one.
The map's header has claimed to be "mechanically kept current" for as long as it has existed; for this
column that is now true.

The check was red on the real tree before the map was reconciled — **7 `map-understates-the-escape`
findings**, one of them the instance recorded below.

**Removing the restatement was preferred where it could be, per the Direction's closing line.** It
could not be removed entirely here: the map's value is that one page answers "what bounds this
pipeline" without opening seven skills. So the fact has ONE owner (the declaration) and the map's cell
is a derived restatement a machine now holds to it — which is the fallback that line reserves for
facts that genuinely must appear twice.

**Steps 2 and 3 remain**, and they are the harder ones: a quantified bound appearing outside its owner
(the shape rounds 9, 10 and 12 kept re-finding in one draft spec), and rule-to-rule contradiction,
which needs its suppression designed before the check is written.

## A live instance, RESOLVED by the above (kept for the record)

`orchestration-map.md`'s Loop-back column states a count-only bound for four pipelines, and one of
them — `delegated-refactor-green-gate` — carries the no-progress escape in its own skill. So the map
contradicts its own skill TODAY, in the direction of understating compliance.

It was recorded rather than patched, because patching those rows would have stated compliance the
other three skills did not have, and would have contradicted what HARNESS-071 contained. The map row
and the skill had to be reconciled together, by whichever item landed first. HARNESS-071 landed first,
gave every finding-set loop the escape, and reconciled every map cell in the same change — and check 1
of the Direction now holds them together, which is what the coupling was waiting for.

## Why this is foundational (or not)

**FOUNDATIONAL.** Every rule in the tree is weakened by the possibility that another rule says the
opposite, and the harness's whole premise is that a rule read is a rule in force. It is filed rather
than fixed inside #1615 because its subject is three unrelated cleanup items; that PR fixed its own
five instances and this item exists so the sixth is caught by a machine.

Related and NOT duplicated: [HARNESS-071](completed/HARNESS-071-loops-with-no-progress-escape.md) is about loops
that lack an escape. This is about documents that disagree. They met in round 13 — a rule contradicted
the rule HARNESS-071 contains — which is why both exist.

## Direction

Do not attempt general semantic contradiction detection. Take the tractable subset first, in this
order:

1. **A claim restated is a claim that can diverge.** The one-owner rule already says a fact has one
   owner; the missing half is a check. Start where the restatement is structured and machine-readable:
   compare `orchestration-map.md`'s Loop-back cell for each pipeline against the bound its owning
   skill states, and fail on disagreement. That alone would have caught round 8 mechanically and it
   extends `scan-orchestration-map.mjs`, which already parses that table.
2. **A quantified bound outside its owner is a copy.** `max N`, `bounded (N …)`, `N iterations`,
   `round cap` naming a pipeline should appear in the owning skill and nowhere else; elsewhere, a
   link. This is the shape rounds 9, 10 and 12 kept re-finding in one draft spec.
3. **Rule-to-rule.** Hardest and most valuable. A first cut: when a rule states a MUST about a named
   subject (`every auto-re-drive loop`, `every guardian`), collect the other rules mentioning that
   subject and require they not state a weaker bound. Expect false positives; design the suppression
   before writing the check, or it will be suppressed rather than obeyed.

Prefer removing the restatement to checking it. Every one of the five instances above existed because
a fact was written twice; the check is the fallback for facts that genuinely must appear in two
places.

## Test Plan

- **Required red-first regression:** each check proven to FAIL against the actual historical
  contradiction it targets — the map at `4cc72938f` said `max 3 + progress detection` while the skill
  said none; `research.md` at `feffbbc1d` said "bounded iterations" while
  `enforcement-architecture.md` forbade a count-only bound. Reverting either must turn the check red
  before it is trusted.
- The check must report what it examined, not merely pass — a contradiction scan that compared zero
  pairs is the vacuity `HARNESS-064` is about.
- `pnpm harness:scan` and `pnpm harness:test` green.

## User Execution Test Scenarios

**Does not apply.** Agent-process documents and their guard; no user-facing surface.
