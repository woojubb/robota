---
title: 'HARNESS-072: nothing detects a contradiction between two rules, only forbidden phrases inside one'
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2485#issuecomment-5460595217
issue: https://github.com/woojubb/robota/issues/1617
created: 2026-08-03
priority: high
urgency: next
area: .agents/rules, .agents/specs, scripts/harness
depends_on: []
---

# HARNESS-072: the conflict scan reads words, not claims

## Resolution

Subsets 1–2 are already shipped; the remaining subset 3 is now canonicalized in [GitHub issue #2485](https://github.com/woojubb/robota/issues/2485). This Task is skipped and archived without claiming implementation completion. Recreate a fresh Task from issue #2485 when selected.

## Progress (2026-08-09)

Subsets 1 and 2 landed as `scripts/harness/scan-loopback-bound-ownership.mjs` (registered, red-proved
against the historical map text at `4cc72938f` and the rounds-9/10/12 draft-spec shape):

- the map's Loop-back cells may not carry a quantified bound — the owning skill states the number,
  the map says "bounded" and points. All four live restatements were REMOVED rather than checked
  (the issue's stated preference), and the two numbers only the map carried (per-signature triages,
  OTP requests) moved into `source-stabilization` and `npm-otp-publish`, which now own them.
- a rule or spec-doc line naming a skill beside a quantified iteration bound is a finding, with
  `allow-restated-bound: <reason>` designed before the check.
- `scan-loop-contract`'s map clause was the two-copies design itself — it DEMANDED the map carry the
  skill's number — and now flags only a cell stating a DIFFERENT number.

Remaining: subset 3 (rule-to-rule — a MUST about a named subject vs a weaker bound elsewhere),
which needs its suppression design first per the direction above.

## Problem

Owner directive, 2026-08-03: **"규칙의 모순은 지속적으로 개선해 나가야 합니다"** — contradictions between
rules must be improved continuously, not fixed once when someone notices.

Nothing in the harness detects one. `scan-conflict-markers.mjs` — registered, named for exactly this —
searches harness prose for forbidden PHRASES (`fallback to`, `temporary workaround`, `sub-agent`). It
cannot see the case where document A states a normative claim and document B states its negation,
because both are written in permitted words.

That gap is not theoretical. [PR #1615](https://github.com/woojubb/robota/pull/1615) produced **five** instances in one change, every one found by a
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

### The same class, measured again on [issue #1640](https://github.com/woojubb/robota/issues/1640) — three sites, one change

A single pull request flipped one flag, `REGRESSION_RED_PROOF_ENFORCE=1`, and left THREE separate
documents asserting the property that flag removed:

| Site                                  | The claim it kept making                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `.agents/tasks/INFRA-046-…md`         | a red here "blocks nothing" because the job is not required                               |
| `.github/required-status-checks.json` | excluded because "a required context must be able to fail, and these deliberately cannot" |
| `.github/workflows/ci.yml` header     | "ADVISORY in v1 … not yet in the required set"                                            |

Every one was found by review, in three separate rounds, none by a machine — and two of them were
written or edited by the same change that falsified them. Two further properties this item should
carry into its design:

- **The contradiction was with CODE, not with another rule.** The prose disagreed with a hook
  (`merge-gate.sh` refuses any non-CLEAN state) and with a workflow env var. A checker that compares
  rule text to rule text would have found none of the three.
- **The claim's own source refuted it.** In each case the file itself, or one it links to, already
  said the opposite. That is a narrower and much more tractable target than general contradiction
  detection: a document asserting a property about a named artifact, where the artifact is readable.

This is the same defect class as the `comment-asserted-invariants` memory entry, which is my
dominant one, and its recurrence here is the argument that the remaining steps are worth the cost.

## A third axis: a rule contradicting a universal principle

Owner directive, same day: **"보편적인 규칙이 더 중요합니다"** — a universal rule matters more than one we
wrote. If the review action argues from a universal engineering principle, that argument can take
priority and OUR rule may be the thing to amend.

The rule set had no clause admitting this. `AGENTS.md` called rules "mandatory, non-negotiable" and
the precedence chain ran `user instructions > RCP conduct > other harness rules > default behaviour` —
a well-founded universal principle appears nowhere in it, so by the letter, citing a harness rule was
always a valid refutation of a review finding. That is the same defect one level up: the rule set
treating itself as terminal.

Fixed in [issue #1615](https://github.com/woojubb/robota/issues/1615) at the authority level — `agent-conduct.md` § "A local rule is an encoding" (with the narrow exceptions: rules encoding a repo-specific fact or an owner decision),
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

### Step 2 — measured, and DELIBERATELY NOT SHIPPED

A copy detector was written and then removed, on evidence. Over every normative harness document it
produced **15 findings and 0 true positives**: `max 72 chars` (a commit-message length), a loop step
mentioning its own escape, a table of contents, an eslint rule name, and — the largest class —
NEGATIONS, where "there is no round cap" reads to a pattern exactly like a round cap.

The class it targets is empty. The three instances this item cites were all in one draft document and
were corrected in the change that filed this; that document now states the removed cap as history and
links the skill that owns the decision, which is what the Direction asks for.

So the choice was between shipping a check with a 15:0 noise ratio and not shipping one. The
Direction's own warning about step 3 decides it — "expect false positives; design the suppression
before writing the check, or it will be suppressed rather than obeyed" — and a check that arrives with
nothing but false positives is suppressed on its first run. Recorded rather than silently dropped:
**what would make step 2 viable is not a better regex but a machine-readable bound everywhere**, the
way step 1's declaration made the map comparison exact. Until a bound outside a skill is structured,
prose matching cannot tell a statement of a bound from a sentence about one.

### Step 3 — the tractable core, shipped

Not "detect any contradiction between two rules", which is the ambition the Direction rightly warns
about. The contradiction that actually arrived had a shape: a RULE described a loop and stated a count
as its only bound, while another rule forbade exactly that. Rules outrank skills, so a reader
following the first was correct to ignore the second.

`scan-loop-contract.mjs` now reads rule documents too. A rule paragraph describing a re-driven loop
must state what a round that changes nothing does, or point at the rule that owns the answer. The
owning rule is held to defining it once rather than restating it per paragraph — demanding otherwise
would be the restatement defect this repository files items about.

**Red-proved against the exact wording round 13 found.** Restoring "bounded iterations, then escalate
to the user" in `research.md` exits 1; the current text exits 0.

**The exemption hole took TWO corrections, and the second is the instructive one.** Splitting on blank
lines is not splitting into passages: a bulleted list in these documents is ONE blank-line block, so an
unrelated bullet's link to the rule that owns the escape still excused a loop bullet that carried
none — the same coincidence, one level tighter. Each list item is its own passage now, with its
indented continuation lines, and the stricter split immediately surfaced a real instance: a bullet
naming the conformance loop leaned on a sibling three bullets away. It carries its own pointer now,
which is what this rule set asks of an entry anyway — a reader must be able to obey one without
opening anything else.

And the first version of that check was an accidental green worth recording: it asked whether the FILE
anywhere linked the rule that owns the escape. Every rule links that rule for other reasons, so the
restored bad wording passed. An exemption read from somewhere else in the document is an exemption
granted by coincidence. Judged per paragraph now, and a case pins that.

**What remains** is step 2, and it remains as a DECISION rather than as work not yet done: it is not
viable as prose matching, and it becomes viable when a bound stated outside a skill is structured. The
general form of step 3 — contradiction between any two rules on any subject — is also still open; what
shipped is the one shape that has actually occurred.

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
than fixed inside [issue #1615](https://github.com/woojubb/robota/issues/1615) because its subject is three unrelated cleanup items; that PR fixed its own
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
