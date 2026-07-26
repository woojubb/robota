---
id: INFRA-059
title: 'INFRA-059: Nothing checks that a workflow`s `uses:` references resolve — one has been dead for 8 months'
status: in-progress
priority: medium
type: INFRA
created: 2026-07-26
urgency: soon
area: .github/workflows, scripts/harness
depends_on: [INFRA-058]
---

# INFRA-059: a workflow can reference an action that does not exist, forever

## Problem

`deploy.yml` has referenced `vercel/action@v1` — **a repository that does not exist** — since it was
written. Every run dies at `Set up job` with `Unable to resolve action`. That went undetected for
eight months and 100+ runs (INFRA-058).

The class matters more than the instance. An unresolvable `uses:` fails _before any step runs_, so:

- there is no failing step in the log to read,
- `--log-failed` returns only the runner provisioner banner,
- and a job that is `if:`-gated or skipped reports the whole run **green**.

It is the quietest possible CI failure, and nothing in this repo would catch another one.

## Proposed check — and why it is NOT `actionlint`

The original proposal was `actionlint` in CI. Measured, `actionlint` does not check the thing this
item was filed for: it does not resolve `uses:` references, which is why the one-off `actionlint` run
recorded in INFRA-038 passed over `vercel/action@v1` at the time. It would have satisfied the
acceptance criterion below while leaving the defect in place for another eight months.

So what landed is a resolvability guard, `scripts/harness/scan-action-references.mjs`, registered in
`scripts/harness/run-all-scans.mjs`:

- **Static half** — parses every `uses:`, and fails on any shape that cannot be verified: a missing
  `@ref`, `main`/`master`/`HEAD`, a `${{ }}` expression, an unsupported scheme, a `./` local action
  with no manifest. It also counts `uses:` lines independently of what it parsed and fails when the
  two disagree, so a parser blind spot cannot report a complete answer from a partial scan.
- **Live half** — `git ls-remote` for the repository and the ref, then the action manifest fetched at
  the resolved commit (repo + ref + subpath, which is what "resolvable" means to the runner). A
  SHA pin's `# vX.Y.Z` comment is checked against where that tag really points.

`actionlint`'s own subject — expression syntax, context typing, `run:` shellcheck — is **not**
delivered here and is filed as **INFRA-064**, together with the scheduled re-check for references
that rot with no PR in flight. The moving-branch-head exposure the live run measured is **HARNESS-055**.

### Where the live half runs

Fail-closed and placement are different questions, and conflating them was the first design's error.
Unreachable is a finding wherever the live half runs. WHERE it runs is: CI on a PR to `develop`, not
a developer machine (`--live` forces it), and **not** on a promotion to `main` — `harness:scan` is
reached by `harness:verify:release` → the `release-grade verification` REQUIRED check on
`protect-main`, and a network half there turns any github.com incident into a blocked promotion, the
failure mode `.github/workflows/ruleset-drift.yml` documents in its own header. The develop-side
`scans` job has already ruled on the identical tree, which `scan-promotion-ancestry.mjs` A3 pins.

## Scope note

INFRA-038 recorded `actionlint` being run **manually** against `ci.yml` during that migration
("actionlint clean on ci.yml"), and it found the `deploy.yml` `codecov-action@v3` warning at the
time. So the tool has already proven itself on this repo once — it simply was never wired in, and
the one-off run did not flag the unresolvable action because plain `actionlint` does not check
resolvability without network.

## Merge-order dependency (not a disclosure — a constraint)

The guard ships with **no suppression list**: a dated "known-unresolvable" entry that exits 0 would
reproduce the loud-report/quiet-failure shape this item exists to end. The consequence is concrete
rather than cosmetic — `scans` is a required check on `protect-develop`, so while `deploy.yml` still
names `vercel/action@v1`, that check is red for **every** PR in the repository. **INFRA-058 must land
first.** Its own recommendation is to delete `deploy.yml`, which makes the cost near zero, but that
deletion is an owner decision, so the owner's call on INFRA-058 now gates this item.

## Acceptance

Criterion 1 as originally written ("a CI job runs `actionlint`") is **superseded**, for the measured
reason above: it does not check resolvability. It is not silently reinterpreted — it is carried
forward as INFRA-064 and replaced here by what actually closes the defect.

- [x] A CI check verifies that every `uses:` reference in every workflow resolves — repository, ref
      and subpath — proven by `scripts/harness/scan-action-references.mjs` registered in
      `scripts/harness/run-all-scans.mjs` (the `scans` job runs `pnpm harness:scan`).
- [x] It is **proven red** against real unresolvable references before being believed — see
      _Red-first proof_ below, five defect shapes, each run live against github.com.
- [x] Its network-failure path exits non-zero, and that path is **exercised**, not reasoned about —
      see _Red-first proof_ row 5.
- [x] Its absent-tree path fails closed and is re-executed on every run, via classification in
      `scripts/harness/scan-guard-scope-fail-closed.mjs`'s `MANDATORY_TREE_GUARDS`.
- [ ] Merged — blocked on INFRA-058 (see above).

## Test Plan

- Unit suite `scripts/harness/__tests__/scan-action-references.test.mjs` (34 tests): the parser and
  its independent line counter, each static rule, each live verdict on injected probe results
  (repo-missing / ref-missing / manifest-absent / tag-mismatch / tag-gone / unreachable / clean),
  the per-occurrence expansion, the fail-closed empty-and-absent-tree cases, and the placement
  policy `liveModeFor`. The network is never called from the unit suite — a unit test that reaches
  github.com reports github.com's health.
- `node scripts/harness/scan-guard-scope-fail-closed.mjs` — executes the new finder against a bare
  root on every run and requires a finding.
- `pnpm harness:test` and `pnpm harness:scan` before push.
- Live red/green runs against the real remote, recorded below.

## Red-first proof

Every row was executed on 2026-07-26 against github.com. The fixture rows drive the real scan
functions (`readWorkflowSources` → `resolveAll` → `probeReference` → `classifyResolution`) over a
throwaway workflow tree; the repository rows run the scan's own entry point.

| # | defect shape                | input                                                        | result |
| - | --------------------------- | ------------------------------------------------------------ | ------ |
| 1 | repository does not exist   | the real tree (`deploy.yml` → `vercel/action@v1`)             | exit 1 — reported at BOTH `deploy.yml:111` and `:121` |
| 2 | ref does not resolve        | `actions/checkout@v99.9.9`                                    | exit 1 — "the ref does not resolve to a tag, branch or commit" |
| 3 | subpath carries no manifest | `github/codeql-action/typo-not-real@v4`                       | exit 1 — resolves to `e4fba868fa4b`, "carries no `action.yml`" |
| 4 | pin claims a tag it is not  | `actions/checkout@8ade135a…` (v4.1.0) commented `# v4.2.2`    | exit 1 — "claims `v4.2.2` … but that tag points at 11bd71901bbe" |
| 5 | network unreachable         | the real tree with `https_proxy=http://127.0.0.1:1`           | exit 1 — 77 findings, "Unreachable is a failure, not a skip" |
| 6 | GREEN (control)             | `actions/checkout@v4`, `github/codeql-action/init@v4`, `actions/checkout@8ade135a… # v4.1.0` | exit 0 — all three resolved, manifests present |

Row 6 is what makes rows 1–5 mean anything: the guard is not simply failing on everything. Rows 1
and 5 use the same tree and differ only in reachability, and produce different verdicts.

A sixth shape — the absent governed tree — is proven by execution rather than by fixture:
`node scripts/harness/scan-guard-scope-fail-closed.mjs` runs `findActionReferenceFindings` against a
root with no `.github/workflows` and requires a finding. It reported
`scan-action-references.mjs#findActionReferenceFindings … is in neither MANDATORY_TREE_GUARDS nor
PENDING_CLASSIFICATION` until the classification entry was added — i.e. the classification gate was
observed FIRING on this scan before it was satisfied.

## Measured facts recorded by the live run

- 13 unique references over 77 `uses:` lines in 14 workflows; 12 resolve, 1 does not
  (`vercel/action@v1`).
- 2 of the 12 resolve through `refs/heads`, not a tag: `pnpm/action-setup@v2`,
  `actions/dependency-review-action@v5` → HARNESS-055.
- 0 references are SHA-pinned, so the tag-mismatch rule has **zero live subjects** in this
  repository and its passing says nothing about this tree — only fixture row 4 exercises it.

## Recommendation Gate

`proposal-reviewer`, 2026-07-26 — **REVIEW VERDICT: REVISE**, folded in before implementation
continued:

- the guard must not be named out of `scan-guard-scope-fail-closed.mjs`'s derived finder set
  ("a gate whose subject is guards that report a pass over ground they never covered, being dodged
  by a new guard") → the root-taking finder is exported and classified instead;
- live-by-default everywhere was justified by a misreading of acceptance criterion 3 and collides
  with the documented `ruleset-drift.yml` policy, given `harness:scan` feeds a required promotion
  gate → placement is now CI-only and off for `main`;
- "ship red and disclose" understates the consequence → restated as a merge-order dependency on
  INFRA-058;
- acceptance criterion 1 must be amended in the open, not reinterpreted, and the dropped `actionlint`
  coverage filed → INFRA-064.

## User Execution Test Scenarios

Not applicable, on the narrow ground the rule allows: this item ships no user-facing surface, no
command behaviour and no runtime behaviour. Its entire product is a CI verdict, and the verdict is
verified by executing the check itself — the six rows above, run by the agent, not reasoned about.
