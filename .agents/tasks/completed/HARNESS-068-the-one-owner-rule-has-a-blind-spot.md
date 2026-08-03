---
title: 'HARNESS-068: the one-owner rule is enforced by a scan, and the second copy of the list sits just outside its reach'
status: done
completed: 2026-08-03
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

## Implementation

Option **2**, as the task judged: the copy is deleted and `CONTRIBUTING.md` links to
`.agents/project-structure.md`, which owns the list. Extending the scan to a second copy would keep
two copies and make a scan responsible for their agreement — the arrangement the one-owner rule exists
to avoid.

**The drift was already real, not hypothetical.** The copy listed `packages/agent-provider`, which
does not exist — and the owning document says so in as many words ("There is **NO** bare
`agent-provider` package").

**And the diagnosis this item was filed on was wrong**, which review round 13 established with one
command. The Task said the name could rot because `check-dependency-direction.mjs` Rule 9 reaches only
the owning document. But `check-ghost-package-refs.mjs` already read EVERY live markdown file,
`CONTRIBUTING.md` included; it was silent because it strips inline code SPANS, and the stale name sat
in backticks. Un-backtick that one line at the merge-base and it fires:
`[ghost-package-path] CONTRIBUTING.md: packages/agent-provider does not resolve to any packages/ directory.`

So the blind spot was never the file list — it was the exemption, and it is repo-wide. The fix went
where the fact is owned: `check-ghost-package-refs.mjs` now scans the four front-door documents
span-inclusive, red-proved at the merge-base. An earlier version of this change instead grew a SECOND
existence check inside a test file, with its own workspace-name set and its own placeholder allowlist
— two mechanisms answering one question from two sources of truth, in the change whose subject is one
owner. That check is deleted.

**The sweep, restated with the measurement it was actually based on.** The first version of this
section said "of every root and `.agents/` markdown file, only `CONTRIBUTING.md` (8 entries) and
`.agents/project-structure.md` (3, the owner) carried a list. No third copy." Review round 3 measured
it with this change's own detector and got different numbers. The claim was a judgement about document
KIND stated as if it were a count, which is the same species of error as the drifted list it justified
removing.

**Measured with the SHIPPED detector** — 174 tracked markdown files, and 145 of the root+`.agents`
subset, enumerate three or more package paths; the owner yields 7, not 3.

The DENOMINATORS are deliberately not quoted. This figure went stale three times: round 3 measured
with a detector the same commit then widened (round 5's finding); round 7 attached a commit name to
numbers taken at an earlier one (round 8's finding); and any commit this PR adds moves the totals
again. The numerators are what the argument rests on — a total that changes whenever a file is added
is a hostage, and quoting one precisely is how a record becomes checkably false rather than merely
approximate.

What the measurement supports: 134 of the 145 are dated records — completed Tasks, archived audits,
closed spec-docs — where a listing is history and correct as written. Of the eleven that are not, one
is the owner and one is `CHANGELOG.md`. Eight name several packages because those packages are the
SUBJECT of the document (an open Task's affected areas, a rule's examples). The ninth,
`worktree-parallel-orchestration/SKILL.md`, reaches the threshold on `packages/foo`, `packages/bar`
and `packages/baz` — placeholders in a worked example, which the ENUMERATION detector counts and the
EXISTENCE check does not. Two questions, two answers; the difference is real and is stated rather than
smoothed over. (That placeholder set moved house twice: round 7 found it missing `baz`, and round 13
deleted the whole duplicated existence check, so round 14 found this sentence describing a mechanism
that no longer existed — and measured the consequence, that a front-door document containing the
repo's own placeholder triple would now be reported. The set lives in `check-ghost-package-refs.mjs`
with a case, which is the one place it belongs.) None is a second copy of
the repository's structure, which is what the one-owner rule is about — and `README.md`, which does
list packages, lists them as an npm catalogue of `@robota-sdk/*` names with descriptions: a curated
index of packages you might install, a different document kind from the internal path layout, and
deliberately not governed by the enumeration rule.

The three `apps/` entries in the deleted block were verified to exist before removal, so nothing
correct was lost with the incorrect entry.

**The declared regression is delivered** —
`scripts/harness/__tests__/front-door-docs-do-not-copy-the-package-list.test.mjs`. The first version of
this change deleted the list and stopped there, which leaves nothing to stop it coming back: this
task's own thesis, unlearned. Red-proved at the merge-base, where the case fails naming all eight
entries.

**And the rule that mattered is extended, not just the ban.** Banning enumerations moves the blind
spot rather than closing it, so the EXISTENCE check now covers every prefixed package name a
front-door document uses OUTSIDE a fence — inside `check-ghost-package-refs.mjs`, which already owned
that question for every other document.

Two limits, stated because the change narrowed coverage in one of them. Fences stay exempt everywhere,
so `npx @robota-sdk/agent-cli` in a README code block is checked by nothing; the deleted test-side
check did read fences, and that is a real loss, accepted because the alternative is a rule that
flags every shell transcript. And a BARE name — no `@robota-sdk/` or `packages/` prefix — is invisible
to both, which is how round 4's instance survived round 3.

Rounds 3 and 4 proved that was not hypothetical, and the second instance is the instructive one.
Round 3 found `README.md`'s architecture diagram still saying `agent-provider`, contradicting a table
twenty lines below it that lists the per-vendor packages which replaced it — fixed by hand, and the
test recorded the limit as "bare names inside a fenced diagram". Round 4 then found `agent-provider`
in README's Quick Start line, in inline backticks in prose, four lines above a snippet importing
`@robota-sdk/agent-provider-anthropic`. The limit was never about fences: the check cannot see any
name carrying no `@robota-sdk/` or `packages/` prefix, anywhere — and it skips fenced blocks, where a
rule matching bare lowercase words would match most of a shell transcript. Stating that limit too
narrowly is what steered the round-3 hand-fix past the second instance. The compensating control is a
wider sweep, not a wider regex: when a package is renamed or split, grep the front-door documents for
the OLD bare name, because no check will do it for you.

Scoped to the four documents read as the CURRENT description of the repository — `CONTRIBUTING.md`,
`README.md`, `AGENTS.md`, `CLAUDE.md` — and that scope is measured, not assumed: of the 145
root+`.agents` files that enumerate, 134 are dated records where a listing is history and correct as
written. (That is the SUBSET whose composition was measured. Round 9 left this sentence citing the
174-file figure, whose composition never was — an unmeasured number carrying the weight of the word
"measured", in the sentence that uses it.) What separates these four is ROLE: a reader of a completed Task knows
they are reading a record, and a reader of `CONTRIBUTING.md` has no way to know a fresher owner
exists. The check also asserts that the OWNER still enumerates, so if the listing ever moves, the rule
fails loudly instead of passing over nothing.
