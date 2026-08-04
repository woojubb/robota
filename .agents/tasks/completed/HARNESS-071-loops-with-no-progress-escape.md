---
title: 'HARNESS-071: almost no convergence loop can notice it is stuck, and the rule that now requires one was landed over them'
status: done
completed: 2026-08-04
issue: https://github.com/woojubb/robota/issues/1616
created: 2026-08-03
priority: medium
urgency: next
area: .agents/skills, .agents/rules
depends_on: []
---

# HARNESS-071: a loop that cannot notice it is stuck

## Problem

`.agents/rules/enforcement-architecture.md` now states, as a mandatory form for every auto-re-drive
loop:

> Every such loop MUST have an escape, and the escape MUST be **no-progress detection**: if a round
> returns the same finding set unchanged, stop and escalate to the user.

Almost nothing satisfies it. The rule was landed in PR #1615 (the PR-review round cap removal);
review round 8 found it violated at landing by its own subjects — including the exemplar the rule's
own sentence names — and rounds 9 through 12 each found the count of those subjects wrong again. The
count is deliberately out of this document's title for that reason.

## Evidence

Measured 2026-08-03. The command is quoted so the result can be reproduced rather than trusted:
round 10 stated a method whose ESCAPE patterns matched nothing in the tree (`recurs unchanged` for
text that reads `recur unchanged`), so following it exactly returned zero compliant skills — the
opposite of what its own table said. Round 11 then quietly dropped `re-drive` from the gate patterns,
which is the whole of the eleven-to-ten movement it reported, and `re-drive` is the term the rule's
bullet is named after; round 12 restored it. Verified identical under both the session `grep` shim and
`/usr/bin/grep`:

```sh
for f in .agents/skills/*/SKILL.md; do
  grep -qiE 'Bounded:|bounded at|bounded to|bounded by|round cap|\*\*Loop\*\*|loop until|repeat until|repeat phase|re-drive' "$f" || continue
  if grep -qiE 'recur[a-z]* unchanged|no-progress' "$f"; then verdict=ESCAPE; else verdict=NONE; fi
  printf '%-8s %s\n' "$verdict" "$(basename "$(dirname "$f")")"
done
```

Its output, verbatim:

```
NONE     architecture-refresh
NONE     automated-review-convergence
NONE     backlog-execution-orchestrator
NONE     capability-extraction
ESCAPE   delegated-refactor-green-gate
NONE     documentation-refresh
NONE     npm-otp-publish
NONE     post-implementation-checklist
NONE     post-merge-cycle
ESCAPE   pr-finding-resolution-loop
NONE     release-orchestration
NONE     user-execution-scenario
NONE     user-request-gate
```

**Two of thirteen.** The eleven divide into two kinds, and the worse one is not the one the rule's
wording anticipates. FOUR are unbounded outright — `architecture-refresh`, `capability-extraction`,
`automated-review-convergence`, `post-implementation-checklist` contain no bound, cap or limit
language at all — and six of the remaining seven bound on a COUNT, which the rule permits only as a second bound. The
seventh, `user-request-gate:70`, is a third kind — "re-drive the researcher (bounded)" with no number
at all, bounded of unstated size.

Spot-checked cites for the shape of what is missing:
`architecture-refresh:58` "**Loop** 1–5 until step 2 says converged" — no escape and no bound at all;
`capability-extraction:36` "Never stop on a round count" — likewise unbounded;
`documentation-refresh:28` a "**round cap** … only a safety checkpoint" — count-only, which the rule
says must never be the only bound; `backlog-execution-orchestrator:59,93` "Bounded: 2 revisions" /
"Bounded: 2 rounds"; `post-merge-cycle:87` "bounded at 2 attempts"; `user-execution-scenario:63,85,96`
per-round caps on a guardian verdict. Note the two kinds: a count-only bound is non-compliant, and an
unbounded loop is worse, so "bounded re-drive" is the wrong description for the NONE set and is not used.

`.agents/rules/` was measured too, because the population above greps only `.agents/skills/` and a
rule can state a loop just as a skill can. THREE rules do: `enforcement-architecture.md` (which states
the requirement), `research.md` — "bounded iterations, then escalate", a count as the ONLY bound in
normative text, describing the very loop `user-request-gate:70` drives — and `spec-workflow.md`, "the
loop repeats until zero discrepancies remain", with no escape and no bound at all.

Both are corrected in this change rather than contained, since a MANDATORY rule contradicting a
MANDATORY rule is not a gap to schedule. The instructive part is HOW the second was found: the first
sweep's pattern list did not contain `repeats until`, so it reported clean and review caught the
miss. A method with a hole reports the absence of what it cannot see — which is this item's whole
subject, committed by its own evidence-gathering. The widened sweep
(`auto-re-drive|re-drives|bounded iterations|round cap|repeat[s]? until|loop repeats`) now returns
ESCAPE for all three.

**Treat the NONE set as a LOWER BOUND, not a census**, in both directions. A keyword grep misses a
loop phrased differently — and it sweeps in at least one step that is not a finding-set loop at all:
`npm-otp-publish:54` bounds how many times it may ask a human for a fresh OTP, where there is no
finding set for a no-progress rule to compare. Rounds 9 through 13 each corrected a hand-kept count
here — the original three, then six, eleven, ten, this — which is the argument for a machine
establishing the set. That is the Test Plan's job.

`architecture-refresh` is the loop the rule cites as the exemplar of the shape ("the
`architecture-refresh` shape: converge on `ACTIONABLE FINDINGS: 0`"), so the rule names as its model
a loop that does not satisfy it.

## Why this is foundational (or not)

**FOUNDATIONAL to the rule, LOCAL to each skill.** Each skill is independently fixable and none blocks
the others, but the rule is not honestly in force until they are: a non-negotiable that its own
subjects break teaches the next reader that the rule group is aspirational. It is filed rather than
fixed in #1615 because that PR's subject is three unrelated cleanup items, and quietly widening it to
rewrite a dozen orchestration skills is the scope creep the depth rule exists to prevent.

The class is the one this repository measures most: **adding enforcement is cheap to write and
expensive to verify reachable.** A rule stating a MUST is not the same as the MUST holding.

## Direction

Add to each loop the escape `pr-finding-resolution-loop` Round B step 4 uses: identify each finding
(`file:line + severity`), compare the round's finding-identity SET to the previous round's, and on an
unchanged set STOP and escalate rather than spin. A count is permitted as a second bound and must not
be the only one.

`documentation-refresh` is the smallest change — it already pauses and reports on reaching its cap, so
it needs the set comparison added ahead of the count, not a new control flow.

The identity-set comparison is ONE rule, so a dozen restatements of it is what HARNESS-068 is about.
Prefer a single owner — a rule section, or a shared skill fragment the loops route to — over a
paragraph pasted into each. Decide that before editing the first skill.

The finding IDENTITY that comparison runs on is `file:line + severity`, and it is settled: the
HARNESS-018 draft defined it two other ways (`file:line + rule/category`, `file:line+rule`) and #1615
unified all of them. Keep it that way — with no round cap the identity is the PR-review loop's sole
bound, so a second definition is a second stuck-detection.

## Implementation

**The rule was the first thing that had to change, and that is not a concession.** It said "every
auto-re-drive loop" and required a no-progress escape from all of them — which is why this item's own
evidence swept in `npm-otp-publish`, a loop that bounds how many times it may ask a person for a fresh
credential and has no finding set for a no-progress rule to compare. A check enforcing the rule as
written would have demanded an escape there and been wrong; a check enforcing what the rule MEANT
would have contradicted the rule. So the rule now names the two kinds:

- **over a FINDING SET** — a round returns findings. A counter cannot see it stuck; the escape MUST be
  no-progress, and a count is an optional second bound.
- **over ATTEMPTS** — a round retries one action that either succeeds or does not. There is nothing to
  compare, so a COUNT is the right bound and the only one available, and it must state a NUMBER.

**The population is established by a machine now.** That is the part this item kept getting wrong: the
count in this file was corrected in rounds 9, 10, 11, 12 and 13, and each correction was another hand
count. `scan-loop-contract.mjs` sweeps every skill body for loop language — deliberately broadly,
because a sweep that misses a phrasing reports the absence of what it cannot see, which is this item's
own subject — and requires each match to declare its kind in one frontmatter line.

The machine immediately found what the hand count had missed: **fifteen** loops, not thirteen or
fourteen. `spec-code-conformance` was absent from the block above, and `spec-first-development` turned
out to REFER to loops it does not drive. The second produced the third declaration kind —
`over=delegated; owner=<skill>` — because the honest answer to a broad sweep catching a reference is
to make the reference explicit, not to narrow the sweep until it starts missing real loops again. The
named owner must resolve to a skill that declares a loop, for the same reason a citation must link to
a record that exists.

**And a declaration is not an escape.** A frontmatter key is cheap, and this repository already has a
floor about declaring a capability and then dodging it. So the check reads two axes: the declaration,
and whether the BODY says what happens when a round returns the same findings. `escape-declared-not-stated`
is its own finding for that reason.

**One owner for the escape itself.** The Direction warned that a dozen restatements of the identity-set
comparison is the defect a sibling item is about. The rule owns what the comparison means; each skill
states the escape as one clause applied to its own loop and links to the rule. No skill restates the
definition.

**One defect review found in the fix, and its detector had the same hole.** The scan hand-rolled its
own frontmatter reader instead of importing the module that owns the `^<key>:` line regex for the
whole harness — the duplication class this repository already paid down, because a single-line regex
mis-reads a value a formatter has wrapped. The instructive half is why nothing caught it: the anti-fork
floor's named-key branch consults an ALLOWLIST of frontmatter key names, and the list did not contain
`loop`, so a genuine fork was judged "not a frontmatter regex" and the floor passed. The fork and the
hole in its detector arrived in the same change. Both fixed, and the floor now pins the two keys added
with it, red-proved by removing them.

Red-proved against the tree as it stood: **15 `undeclared-loop` findings, exit 1**; after, exit 0. The
map axis was red on the real tree too — reconciling the orchestration map came after the scan was
written, and it reported **7 `map-understates-the-escape`** findings first.

## Test Plan

- **Required red-first regression:** a mechanical check that every skill file describing an
  auto-re-drive loop over a FINDING SET states a no-progress escape — proven to FAIL against the
  NONE loops that are finding-set loops before it is trusted, and to PASS on the two that
  comply. Without it this closes by editing prose and nothing keeps it closed, and the count in this
  file goes stale a sixth time.
- Deciding which loops are in scope is part of the work, not a precondition: `npm-otp-publish` bounds
  requests to a human and has no finding set, so a check that demands an escape there would be wrong
  in the other direction.
- The check defines the population; this file's output block does not. If the check finds a loop the
  block misses, the block was wrong, not the check.
- `pnpm harness:scan` and `pnpm harness:test` green.

## User Execution Test Scenarios

**Does not apply.** Agent-process documents and their guard; no user-facing surface.
