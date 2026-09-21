---
title: 'HARNESS-2804: A branch CLASS has no required-check contract, so nothing can say what a child PR into integration/** must carry'
issue: https://github.com/woojubb/robota/issues/2804
status: todo
created: 2026-09-21
priority: medium
urgency: soon
area: ci
depends_on: []
---

# HARNESS-2804: A branch CLASS has no required-check contract, so nothing can say what a child PR into integration/\*\* must carry

## Problem

The repository can express "what must pass before a merge into B" in exactly one shape: an **exact
branch name** in `.github/required-status-checks.json`, paired with a live GitHub ruleset.

- The reader is exact-match: `scripts/harness/required-status-checks-declaration.mjs:56` —
  `JSON.parse(...)?.branches?.[branchName] ?? null`. A branch _class_ cannot be keyed at all.
- Every entry is paired with a live `ruleset` / `ruleset_id` and reconciled by
  `scan-main-required-checks.mjs --live`. Integration branches carry no ruleset, and creating one is
  a repository protection setting rather than code.
- The file's own `$schema-note` already concedes: "A declaration alone does not prove the live
  ruleset applies to its branch."

The AGREEMENT stacking model made `integration/**` a **merge target**. It is a branch class, and it
can hold neither half of that contract. So no artifact — local or remote — can say which checks a
child pull request into an integration base must carry, and every consumer that needs the fact has
to invent a stand-in.

## Evidence that this is already costing something

**Measured on INFRA-2804.** That change's own § Recommendation specified "a non-empty,
**name-matched** required-check set"; what shipped in `.claude/hooks/merge-gate.sh` asserts a
non-empty **count**. Not an oversight — there was nothing to match against.

The gap is not theoretical. `ci.yml`'s `changes` job carries no `if:` condition (the branch's own
test asserts exactly that), so **that one job alone satisfies the gate**. Independently, a lone
`Secret scan (gitleaks)` pass satisfies it while `ci.yml` never dispatched at all. `review-gate` is
one of `develop`'s eleven declared required contexts; ten of the eleven could be absent and the hook
would still report coverage.

**Issue #2798 is the same cause failing on the branch the model WAS designed for**: `protect-develop`
has targeted no ref since 2026-09-06, and the reconciler that would have reported it has not run
since 2026-08-11. A contract that binds only through a live ruleset fails silently when the ruleset
stops matching — on `develop` as readily as on a branch class.

## Why it is not fixable at the reported site

Two local fixes exist for `merge-gate.sh` and both are the wrong shape:

- Hardcoding the expected context names in bash creates a second owner of a fact
  `.github/required-status-checks.json` owns.
- Deriving the expected set from the workflows' own `branches:` filters creates a third owner, and
  would count advisory checks as coverage.

And the fix does not live there under either resolution of the open question. If the owner creates an
`integration/**` ruleset, the contract lands in the protection layer plus the registry. If they do
not, the registry's schema has to change to express a class. `merge-gate.sh` is downstream either
way — fixing it there would leave it the only place in the repository holding an opinion about what
an integration base requires.

## Plan

- [ ] Decide the prior question with the owner: does `integration/**` get a GitHub ruleset, or is it
      declared out of protected scope? Issue #2798 is entangled and should be settled with it
- [ ] If a ruleset: add the `integration/**` entry to `.github/required-status-checks.json` and
      extend `scan-main-required-checks.mjs --live` to reconcile a pattern target
- [ ] If not: extend the registry schema to express a branch CLASS with an explicit
      `enforced_by: local` marker, so a declaration that no ruleset backs is visibly that
- [ ] Either way, replace the count assertion in `.claude/hooks/merge-gate.sh` with a name-matched
      one reading the registry, and remove the `Contained — HARNESS-2804` label there
- [ ] Re-check the other consumers of `required-status-checks-declaration.mjs` for the same
      exact-match assumption
- [ ] While that jq is being rewritten, use `(.statusCheckRollup // [])`. Today a `null` rollup makes
      the filter abort and the hook prints "could not read … check list" for what is actually an
      EMPTY list — the precise distinction the block exists to draw. Deferred out of INFRA-2804
      rather than edited inside a contained hold, on review advice, and carried here so it is not
      lost

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This item concerns which checks a forge requires before a merge, and the artifacts that
declare them. It alters no `robota-cli`, `robota-tui`, `robota-browser-ui` or `public-sdk-example`
surface, so a person running the product observes identical behaviour whichever way it is resolved.
Its observables are a GitHub ruleset's configuration and a local hook's refusal message, neither of
which a user reaches by executing Robota.
