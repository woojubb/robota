---
title: 'INFRA-104: a merged Closes #N never reaches main, so finished issues stay open'
status: in-progress
created: 2026-08-18
priority: high
urgency: now
area: scripts/harness, .github/workflows, .github/required-status-checks.json
depends_on: []
---

# INFRA-104: carry the closing keywords to `main` at the promotion boundary

## Objective

Make a finished GitHub issue close itself. Today every work PR writes `Closes #N` into a PR that
targets `develop`, and GitHub reads closing keywords only on a PR targeting the default branch — so
the keyword is ignored on every work PR in this repository, and issues are closed by periodic manual
triage batches instead. The stale queue then feeds the session-start hook, which reported two finished
items (#1750, #1722) as outranking unfiled work.

Derive the closing keywords a promotion carries, print them where the promotion PR body is composed,
and guard the promotion PR against omitting one.

## Spec

`.agents/spec-docs/active/INFRA-104-promotion-carries-closing-keywords-to-main.md`

## Plan

- [x] TC-01: `promotion-closes.mjs --base --head` prints one `Closes #<n>` per OPEN issue referenced
      by a carried PR body.
- [x] TC-02: an unreadable carried PR body exits non-zero, names the PR, and prints no partial block.
- [x] TC-03: a `Closes PROV-007.` body (a Task ID, not an issue) contributes no line.
- [x] TC-04: an already-CLOSED issue contributes no line.
- [x] TC-05: `node scripts/harness/promote.mjs` prints the block above its `gh pr create` line.
- [x] TC-06: `scan-promotion-closes.mjs --pr <n>` fails a `main`-based PR whose body omits an implied
      keyword, and passes when the body carries all of them.
- [x] TC-07: the guard exits 0 (not-applicable) when the PR base is not `main`.
- [x] TC-08: `pnpm harness:scan` and the harness unit tier are green.
- [x] TC-09: `scan-main-required-checks.mjs` exits 0 with the new required context declared under
      `branches.main`.
- [ ] TC-10 (user-execution): the next promotion PR carries the block and GitHub — not a person —
      closes the issues it names. `#1722` is the first case.

## Test Plan

Unit tests under `scripts/harness/__tests__/` cover the derivation and the guard against stubbed
GitHub readers, in both directions: a clean input produces the expected block, and every fail-closed
edge (unreadable PR body, non-issue `Closes` target, already-closed issue, non-`main` base) is asserted
explicitly so the guard is proven able to fail rather than assumed to be. `promote.test.mjs` is extended
to assert the block reaches the operator-facing output. `pnpm harness:scan` covers the repository-wide
tier, and `scan-main-required-checks.mjs` proves the new required context resolves to a job that
actually runs and can fail on a PR based on `main` — a required context that cannot fail is the vacuity
INFRA-055 measured on promotion #1427. TC-10 is verified by observation of a real promotion, which no
automated test may perform.

## Progress

### 2026-08-18

- Measured the defect: PR #1802 (`Closes #1750`) and PR #1816 (`Closes #1722`) both merged into
  `develop`; neither issue closed. GitHub's documented behaviour is that keywords on a non-default-branch
  PR are ignored and no link is created.
- Established that the keyword source must be the PR body, not the commit: the squash commit for
  PR #1802 (`93d061dd3`) carries no `Closes` line, because GitHub's squash body concatenates the commit
  messages rather than the PR description.
- Established that a `Closes` target is not always an issue: PR #1801's body opens `Closes PROV-007.`
- GATE-WRITE and GATE-APPROVAL passed; owner answered D1 (guard is a required check on `protect-main`)
  and D2 (reconcile finished work only, touch nothing in flight).
- Measured the D2 reconciliation list and found it **empty**: #1750 was already closed by hand, #1722's
  work has not reached `main` yet, and every other open issue is unstarted or in flight in another
  working tree.

- Implementation landed: `promotion-closes.mjs` (derivation) and `scan-promotion-closes.mjs` (guard),
  the `promotion closes` job in `.github/workflows/ci.yml`, the context declared under `branches.main`
  in `.github/required-status-checks.json`, and the invariant recorded in
  [publish.md](../rules/publish.md) § Promotion Body — Closing Keywords.
- TC-01…TC-09 verified locally: 44 unit tests green across `promotion-closes.test.mjs` (18),
  `scan-promotion-closes.test.mjs` (12) and `promote.test.mjs` (14); `pnpm harness:scan` 123 passed /
  2 skipped / exit 0; `pnpm harness:test` 3750 + 1090 tests green;
  `node scripts/harness/scan-main-required-checks.mjs` exit 0 with all four `main` contexts reported
  as able to run and fail.
- Harness floors the new modules had to satisfy, and how: `measurement-provenance` — both modules
  carry `::examined::`, so each now exports its size reader (`examinedPullBodyCount` /
  `examinedIssueRecordCount` / `examinedIssueCount`), increments it AT the read rather than reading a
  result's length, and is asserted against an exact value plus a second-run reset; both are recorded
  `covered`, not pending. `ci-concurrency-footprint` — the frozen job count rose 22 → 23 for the new
  job and was re-frozen deliberately. `rule-case-narrative` — the rule text states the invariant and
  relocates the incident to this record via a resolving link, rather than retelling it.
  `spec-user-execution-section` — the spec document now carries the section, marked not applicable
  with its reason (no product surface changes).
- `deriveClosingLines` was renamed `collectClosingLines` so the traversal is reachable under the
  harness finder convention that the counter-reset case has to run twice.
- TC-10 remains open by design: it is observed on the next promotion, not executed here.

### 2026-08-21 — TC-10 is unobservable today, and here is exactly why

The guard has since been exercised. `main` now contains `17288be5d`, carried by promotion PR #1895
(2026-08-19), and `promotion closes` ran as a required context on it.

**It produced an EMPTY block, legitimately.** That promotion's body records the derivation: 53
carried pull-request bodies read, 12 referenced issues checked, every one already closed —
including issue #1722, which this item's spec had expected to be the first issue GitHub closed by
itself. It was closed by hand the day before.

So the guard works and the mechanism is proven; the half TC-10 asks about — GitHub, not a person,
closing an issue — has still never been watched.

**Measured on 2026-08-21: there is no candidate.** Every `Closes` reference in the pull requests
merged to `develop` and not yet on `main` points at an issue that is ALREADY CLOSED. A promotion run
today would produce another empty block, so promoting does not satisfy TC-10 either.

**What would.** An issue that is (a) named by a closing keyword in a PR merged to `develop` and
(b) still open when the next promotion runs. That is a sequencing condition, not work — and it is one
this session actively removed four times, by closing issues #1903, #1912, #1898 and #1899 BY HAND
after their work landed on `develop`. Closing them by hand was correct for the goal in front of me
and it consumed the observation this item needs; recording that here so the next agent does not
repeat it without noticing.

Left `in-progress` deliberately. The implementation, the required-context wiring and TC-01…TC-09 are
complete; only the observation is outstanding, and manufacturing work to observe it would be worse
than waiting for it to arise.

### 2026-08-22 — re-measured, and the disposition confirmed with the owner

`develop` is 70 commits ahead of `main`. Every `Closes` / `Fixes` / `Resolves` reference in the
commits `develop` carries and `main` does not names an issue that is ALREADY CLOSED — re-checked
against the live issue states, not against the record. So a promotion run today would derive an
empty block for the second time, and TC-10 would still not be observed.

Put to the owner on 2026-08-22 with three options: leave it, promote now, or manufacture a candidate
by reopening one of the issues this session hand-closed. **Chosen: leave it `in-progress`.**
Manufacturing the condition would satisfy the checkbox by arranging the evidence, which is the shape
this repository refuses everywhere else.

### 2026-08-22 — correcting how this refusal was justified

I said these items could not be marked `done` "because `unearned-done-claims` exists to refuse it".
**That was wrong about the mechanism.** Probed by actually doing it — all four set to `status: done`
with a `completed:` date and moved to `completed/` — and `unearned-done-claims`, `backlog-placement`
and `task-archival` all PASSED. The only failures came from inbound links breaking as the files
moved.

So nothing mechanical would have objected. The record would simply have been false, and that is the
reason on its own. Citing a scan that does not do the work was a stronger-sounding argument than the
true one.

The substantive grounds are unchanged, and were re-measured rather than restated:

| item      | completion condition, executed 2026-08-22                                    |
| --------- | ---------------------------------------------------------------------------- |
| INFRA-046 | `protect-develop`'s required list contains neither gate                      |
| INFRA-054 | three owner decisions outstanding; no fast-forward promotion has occurred    |
| INFRA-097 | `2 of 2` guarded workflows still load their definition from the pull request |
| INFRA-104 | the last promotion body carried `0` closing keywords                         |

The gap the probe exposed — a `done` task with unticked acceptance criteria passes every scan — is
filed as issue #1965 rather than folded in here.

### 2026-08-22 — TC-10 has a live subject for the first time

Every earlier entry records the same blocker: every closing reference `develop` carried named an
issue that was ALREADY CLOSED, so a promotion derived an empty block and the half TC-10 asks about —
GitHub, not a person, closing an issue — had nothing to act on.

Re-measured today, reading each referenced issue through the API rather than trusting the record:

```
referenced by a closing keyword on develop-not-main:  16
  closed:  15
  OPEN:     1   -> issue #1965
```

**Issue #1965 is open, and `Closes #1965` is on `develop`.** GitHub ignored that keyword because the
pull request did not target the default branch — which is the exact defect this item exists to
compensate for — so the issue survived to become the first live subject the promotion block can name.

It arrived from ordinary work. Issue #1965 was filed after probing whether four blocked items could be
marked `done` (every existing scan passed, which was the defect); another session implemented the
guard and merged it with the closing keyword. Nothing was arranged to produce this.

**One measurement note, because it nearly went the other way.** The first sweep reported "no open
candidates" — but four of the sixteen reads had TIMED OUT, and a timeout is not an answer of
"closed". Re-run distinguishing an error from a state, `#1965 open` appeared. `merge-gate` refused a
merge on the same principle an hour earlier ("no answer is a refusal — it is NOT an answer of
'none'"), and this is the same trap one layer down, in a survey rather than a gate.

**What remains for TC-10 is one event: the next promotion.** What to check when it happens, written
BEFORE the evidence exists so the reading cannot be fitted to it:

1. the promotion body carries a non-empty block naming issue #1965;
2. the `promotion closes` job reports green on the promotion pull request. It is ADVISORY, not
   required: `.github/required-status-checks.json` declares it required on `main` and the live
   `protect-main` ruleset does not, filed as issue #1980. It still runs, and a failure would show as
   `UNSTABLE`, which `merge-gate.sh` refuses — so it stops this repository's merge path, not GitHub's;
3. issue #1965 is closed by GITHUB — the close event attributed to the merge, not to a person.

Any of the three failing is a finding about this item, not about the promotion. In particular,
if issue #1965 is closed by hand before then, the subject is consumed and TC-10 waits again — which is what
happened four times earlier in this session and is recorded above.
