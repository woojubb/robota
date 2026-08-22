---
title: 'INFRA-046: promote advisory CI gates (regression-red-proof, patch-coverage) to blocking'
status: in-progress
created: 2026-07-25
priority: high
urgency: now
area: .github/workflows/ci.yml, repo rulesets
depends_on: [INFRA-071]
---

# INFRA-046: advisory→required gate promotion

## Problem

Two quality floors run advisory-only by design (v1 rollout): `regression-red-proof` (HARNESS-041) and
`patch-coverage` (INFRA-041). Advisory gates that stay advisory forever become noise.

## What

Define + apply the promotion criteria: after N=10 code-PRs each with zero false-positive verdicts
(evaluated from the jobs' logged decisions), flip `REGRESSION_RED_PROOF_ENFORCE=1` /
`PATCH_COVERAGE_ENFORCE=1` and add the job(s) to the develop ruleset's required checks (they are
`changes`-gated, so docs-only PRs skip=pass, same as tui-e2e). Record the false-positive tally in the PR.

## Promotion Audit 2026-07-25 — NOT PROMOTED (neither flag flipped)

Evidence window: the 40 most recently merged `develop` PRs (#1340–#1379). `patch-coverage` landed in
#1329 and `regression-red-proof` in #1272, so both gates existed for every PR in the window.

**Method.** The advisory check-run conclusion is worthless as evidence — both scripts `process.exit(0)`
unconditionally in v1, so all 54 job runs report SUCCESS regardless of verdict. Each job's _log_ was
pulled (`gh api repos/woojubb/robota/actions/jobs/<id>/logs`) and the logged verdict line read
directly. 27 of the 40 PRs were code PRs (the other 13 were docs-only and correctly `SKIPPED` by the
`changes` gate). No log contained an `orchestration error`, `detect error`, `dirty-tree`, or
`run-error` — nothing was masked.

### `regression-red-proof` — 0 of 10 qualifying PRs (blocked on N, not on quality)

| Logged decision                                      | PRs                                                                                                                     | Count |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----- |
| `SKIPPED: range has no `fix:` commit`                | #1342 #1343 #1344 #1346 #1347 #1348 #1350 #1351 #1353 #1354 #1357 #1358 #1359 #1360 #1361 #1364 #1368 #1370 #1374 #1376 | 20    |
| `SKIPPED: no same-package (source+test) pair`        | #1352 #1363 #1365 #1375 #1377 #1378 #1379                                                                               | 7     |
| `red-proof-ok` / `accidental-green` / `inconclusive` | —                                                                                                                       | **0** |

Every skip was verified honest: the 20 "no `fix:` commit" PRs are all `feat:`/`refactor:`/`chore:`/
`ci:`/`test:`; of the 7 "no pair" PRs, six touch **zero** `packages/**` or `apps/**` files at all, and
#1375 (`fix(agent-transport)`) changed `headless-runner.ts` with no accompanying test file — a correct
negative, not a missed pair. **Zero false positives, but also zero substantive verdicts.** The gate's
core logic (reverse-apply the fix, require the test to go RED) has never once executed on a real PR.
Promoting it now would make a required check out of a code path with no production evidence.

Remaining to qualify: **10** PRs that reach a real verdict, i.e. `fix:` PRs carrying a same-package
source+test pair. At the observed rate (0 in 40 merges) this will not accumulate passively — see the
blocker below.

### `patch-coverage` — 16 qualifying PRs (N met) but **not** zero false positives

| Verdict                          | PRs                                                                     | Count |
| -------------------------------- | ----------------------------------------------------------------------- | ----- |
| `patch-coverage-ok`              | #1346 #1350 #1351 #1353 #1357 #1358 #1359 #1360 #1370 #1374 #1375 #1376 | 12    |
| `inconclusive-no-data`           | #1347 #1361                                                             | 2     |
| `patch-coverage-below-target`    | #1344 #1348                                                             | **2** |
| no coverable src changes (no-op) | #1343 #1352 #1354 #1363 #1364 #1365 #1368 #1377 #1378 #1379             | 10    |

`inconclusive-no-data` never blocks under `PATCH_COVERAGE_ENFORCE=1` (only `BELOW_TARGET` exits 1), so
#1347/#1361 are not promotion blockers. The two BELOW-TARGET verdicts are, and both were adjudicated:

- **#1344 `feat(docs)` — 0/56 (0.0%) — FALSE POSITIVE.** Every missed file is a React `.tsx` component
  in `apps/docs`, which has **zero** test files under `src` (`find apps/docs/src -name '*.test.*'` → 0).
  The check's own contract says a package whose coverage data cannot be produced must be
  `INCONCLUSIVE` with an explicit NO-DATA log; instead an all-zero-hit lcov for a suite-less app is
  misread as "you failed to test your changed lines". Under enforcement this would have blocked an
  inline-styles→Tailwind conversion with no remedy short of standing up a component-test stack.
- **#1348 `feat(cmd-004)` — 124/159 (78.0%) — TRUE POSITIVE (borderline).** `agent-transport-gui` does
  have coverage infra (4 suites; `ui-intent-state.ts` 42/42, protocol files 100%/96%). The shortfall is
  real: `SessionSurface.tsx` 0/20 and `useSessionClient.ts` 0/11 are genuinely unexercised render
  surfaces. It misses the 80% target by 2 points, i.e. blocking would have been defensible but harsh.

One confirmed false positive is one more than the criterion allows. **Do not flip
`PATCH_COVERAGE_ENFORCE`.**

### Blockers to clear before re-running this audit

1. **`patch-coverage` must not charge a PR for a package that has no test suite.** When a package/app
   contributes only all-zero-hit lcov records and owns no test files, classify it `UNINSTRUMENTED`/
   NO-DATA (→ `INCONCLUSIVE`, advisory) instead of folding those lines into the BELOW-TARGET total.
   This is the #1344 defect and it is in `scripts/harness/check-patch-coverage.mjs`.
2. **Decide the React-UI policy** (#1348 class): either exclude `.tsx` render surfaces from the patch
   denominator, or stand up component-test infra for the GUI packages. Promotion is unsafe until one
   of the two is chosen, or every UI PR pays a coverage tax it cannot discharge.
3. **`regression-red-proof` needs real verdicts.** Consider back-testing it over historical `fix:` PRs
   that _did_ ship a source+test pair (replay the checker against those merge-bases) rather than
   waiting for 10 to accrue organically — the current merge pattern produces roughly none.

Re-run this audit after (1)–(3); promote only the gate whose own criterion is then met — the two flags
are independent and do not have to flip together.

## Test Plan

A deliberately-failing fixture PR proves each gate BLOCKS post-promotion; docs-only PR proves skip=pass.

Post-promotion verification (not yet executed — nothing was promoted):

1. **Blocking proof.** Open a PR against `develop` whose head commit is `fix(<pkg>): …` and which edits
   one `packages/<pkg>/src` file plus a test that passes with the source change reverse-applied. With
   `REGRESSION_RED_PROOF_ENFORCE=1` the job must log `accidental-green` and exit 1. For patch coverage,
   add an uncovered exported function to a package that has tests; the job must log
   `patch-coverage-below-target` and exit 1. In both cases the PR's merge button must be blocked, which
   only holds once the checks are in the ruleset (see below).
2. **skip=pass proof.** A docs-only PR must show both jobs `SKIPPED` and stay mergeable — GitHub counts
   a skipped required check as satisfied, the same arrangement `tui-e2e` already relies on.

## Owner Action (required only when a flag is actually flipped)

Flipping the env flag alone does **not** block a merge — the job must also be listed in the `develop`
ruleset's required checks. That call needs repo-admin scope and was deliberately not attempted, since
this audit promoted nothing. When a gate does qualify, add its check name
(`regression-red-proof (advisory)` / `patch-coverage (advisory)`, renamed without the `(advisory)`
suffix if the flag is flipped) to the ruleset:

```bash
gh api repos/woojubb/robota/rulesets --jq '.[] | "\(.id)\t\(.name)"'   # find the protect-develop id
gh api repos/woojubb/robota/rulesets/<id> > ruleset.json                # capture current state first
# edit the required_status_checks rule's required_status_checks[] array, then:
gh api -X PUT repos/woojubb/robota/rulesets/<id> --input ruleset.json
```

## Evidence added 2026-07-28 — this is not a rollout question any more

A four-way recurrence audit measured what these two floors are currently worth:

- `check-regression-red-proof` is **not registered in `run-all-scans`** at all. It runs only as
  `ci.yml`'s `regression-red-proof (advisory)`, exits 0 on failure, and its enforcing branch is
  gated on `REGRESSION_RED_PROOF_ENFORCE` — **set in no workflow**. Same shape for
  `check-patch-coverage`.

  > **Half of this is STALE as of 2026-08-04, re-measured 2026-08-22.** The flag IS set:
  > `.github/workflows/ci.yml` carries `REGRESSION_RED_PROOF_ENFORCE: '1'` with the owner decision
  > recorded beside it, and the job is now named `regression-red-proof (enforcing: accidental-green
only)`. So it CAN fail, and "nothing can fail on it" below is no longer true of this gate.
  >
  > What still holds: it is not registered in `run-all-scans` — verified by grep, no entry — and
  > that is correct rather than a gap. It reads `PR_BODY` and a merge-base diff, so it has no
  > hermetic tree to judge; registering it would put a check that cannot reach a verdict into a
  > suite whose passes are read as verdicts. `promotion-closes` is excluded from `harness:scan` for
  > the same reason and says so.
  >
  > `check-patch-coverage` is unchanged: still advisory, still `PATCH_COVERAGE_ENFORCE`-gated, and
  > excluded from the required list on the ground that a required context must be able to fail.

- The defect it exists to catch recurred **twice in one session** (ARCH-004 RUNTIME-14, CORE-026
  RUNTIME-12) and is `common-mistakes` #82.

So the repository has a built, tested floor for its accidental-green class and **nothing can fail on
it**. (Half-corrected above: the flag has since been set, so `regression-red-proof` CAN fail; only
the required-list half remains.) The change is two environment variables and moving two contexts to required — the smallest
mechanical prevention on the whole audit's list, against a class with confirmed recurrence.

## Promotion Audit 2026-07-31 — NOT PROMOTED (neither flag flipped)

**Evidence window.** The 12 most recent successful `ci.yml` runs (2026-07-30, PRs #1525–#1530 and
their promotion runs). Every one of them post-dates both gates.

**Result: no verdict was produced at all.** Not one run reached a decision to evaluate for false
positives.

| Verdict                                       | Runs |
| --------------------------------------------- | ---- |
| `RED_PROOF_OK`                                | 0    |
| `ACCIDENTAL_GREEN`                            | 0    |
| `INCONCLUSIVE`                                | 0    |
| `SKIPPED: no same-package (source+test) pair` | 9    |
| `SKIPPED: range has no fix: commit`           | 1    |
| no verdict line (promotion runs)              | 2    |

**Why.** `pkgOf` in `check-regression-red-proof.mjs` matches
`^((?:packages|apps)/[^/]+)/src/` and nothing else. The gate therefore cannot see:

- `.claude/hooks/**` — every guard in the repository
- `scripts/harness/**` and `scripts/harness/__tests__/**` — every scan, floor and their tests

Confirmed by executing `classifyChanges` over a file list drawn from these PRs: a
`packages/agent-core/src` pair qualifies; `.claude/hooks/branch-guard.sh` with
`scripts/harness/__tests__/branch-base-at-creation.test.mjs` yields nothing.

**Why that matters more than the tally.** The gate exists to catch a regression test that passes on
the unfixed code. During this same window human review caught FOUR such tests, all of them mine, all
in `scripts/harness/__tests__/` — a coverage floor that counted a comment as coverage, an
unset-variable case that never reached the crash it named, an extension-filter case that never
reached the filter, and two hook cases that exercised only guard clauses. The mechanical floor for
that exact defect was blind to every one of them.

So the promotion criterion — N=10 code-PRs with zero false-positive verdicts — cannot be satisfied by
work in this area, not because the gate is accurate but because it never runs. Promoting on a tally
of zero verdicts would make a required check that is required to do nothing.

**Blocked on:** INFRA-071 (widen the gate's subject to the harness and hook layer). Re-run this audit
once verdicts exist.

## Promotion Audit 2026-08-04 — `regression-red-proof` PROMOTED (owner decision)

**The 2026-07-25 audit blocked on evidence, not on quality, and the evidence changed.** That audit
found ZERO substantive verdicts across 40 pull requests: the reverse-apply-and-re-run path had never
once executed, so promoting it then would have made a required check out of untested code.

INFRA-071 widened the subject from `packages|apps/*/src` to include `.claude/hooks` and
`scripts/harness`. Re-measured over the 22 most recent CI runs by reading each job's log directly, the
way the previous audit did — the check-run conclusion remains worthless as evidence:

**13 runs produced `red-proof-ok`.** Zero `accidental-green`. The remainder are honest skips
(`range has no fix: commit`) and `inconclusive` verdicts on individual pairs.

**What promotion does, exactly.** `REGRESSION_RED_PROOF_ENFORCE=1` makes exactly ONE verdict exit
non-zero: `accidental-green`. `inconclusive`, `red-proof-unreached` and all three `skipped-*` values
still pass. That asymmetry is the whole of it — the gate blocks on a proven defect and never on an
absence of proof, so a pull request cannot be refused for a conclusion the checker could not reach.

The mapping was inline in the CLI block, where the one decision this item changes could not be
exercised. It is now `exitCodeFor(verdict, enforce)`, exported, with a case asserting all seven
verdicts in both modes and a case asserting the workflow actually sets the flag — a policy no run
applies is the vacuity this harness spends its time removing.

**Required-check membership is deliberately HELD** (owner decision). `accidental-green` has never
fired on a real pull request, so its blocking path is unproven in production; making it required would
put an untested refusal in the merge path. One observed firing is the evidence the next step needs.

**A crash in the checker no longer reports success.** Its `.catch` exited 0, justified by a comment
saying the job is advisory — a justification that stopped being true the moment it began enforcing. A
crash that reports green is indistinguishable from "ran and found nothing wrong", which is the vacuity
this harness spends its time removing.

The first fix made the crash exit non-zero unconditionally, on the reasoning that a red here "blocks
nothing" because the job is not required. **That reasoning was false in this repository, and the
correction is the part worth recording.** `merge-gate.sh` refuses on any `mergeStateStatus` other than
CLEAN, and GitHub reports `UNSTABLE` precisely when a NON-required check fails — so a non-required red
blocks every merge just as thoroughly, through a door required-check membership does not guard. Held
membership bought nothing against it. Review caught it; the local tests did not, because none of them
knew what the merge gate does with the exit code.

What survives the correction is the RULE, not the convenience: enforcement-architecture.md § "Silence
is not success" says the three states must stay distinguishable, and "I could not check" is a refusal,
never a pass. So the crash exit reads the same `enforce` switch the verdicts are judged by, and while
enforcing it refuses — deliberately, with the merge-blocking consequence understood and stated rather
than denied. The cost is real: a transient infrastructure failure stops merges until it is fixed. That
is the price of the rule, and the alternative — merging past a checker that could not run — is the
hundred-green-runs-reviewing-nothing failure the same rule was written after.

Two cases pin it, each red-proved on its own assertion, and one of them asserts the merge gate still
refuses a non-CLEAN state, so this decision returns for review if that ever changes instead of quietly
becoming wrong a second time.

**`patch-coverage` is NOT promoted** and this item stays open for it.

## Progress

### 2026-08-21 — BLOCKED on repo-admin scope, and the block is precise

Everything this item can reach without that scope is already done: `REGRESSION_RED_PROOF_ENFORCE=1`
makes an `accidental-green` verdict exit 1, and `.github/required-status-checks.json` records, for
each of the two gates, why it is not required.

**What remains is one `gh api -X PUT` against the `protect-develop` ruleset**, which needs repo-admin
credentials this agent does not have. The exact command is in ## Owner Action above.

**And it should NOT be run yet, on this item's own evidence.** `deliberately_not_required` in
`.github/required-status-checks.json` records the reason for `regression-red-proof`: `accidental-green`
has never fired on a real pull request, so making it required would put an UNTESTED refusal in the
merge path. One observed firing is what promotes it. `patch-coverage` is excluded for the different
reason that it deliberately cannot fail, which INFRA-094 did not change — that item removed a
duplicate build, not the advisory posture.

So the block is not "waiting for a credential". It is waiting for evidence, and the credential after
it. Recorded as `blocked` rather than `todo` so the distinction is readable.

### 2026-08-22 — the remaining action, stated exactly, and why it is not taken

Re-measured rather than repeated:

| claim                                               | state                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `REGRESSION_RED_PROOF_ENFORCE` set in no workflow   | **STALE** — set in `ci.yml`, with the 2026-08-04 owner decision recorded at the line                     |
| `check-regression-red-proof` not in `run-all-scans` | **HOLDS**, and is correct: it reads `PR_BODY` and a merge-base diff, so it has no hermetic tree to judge |
| the two contexts are not required                   | **HOLDS** — `protect-develop` (id 18715844) requires nine contexts and neither of these is among them    |

The nine: `build`, `quality`, `scans`, `dependency audit`, `commitlint`, `tui-e2e`,
`examples-typecheck`, `windows-shell`, `review-gate`.

**The remaining action is one `gh api -X PUT` against that ruleset, and it needs repo-admin scope
this agent does not have.** The command shape is in ## Owner Action above.

**It should also not be run yet, on this item's own reasoning.** `accidental-green` has never fired
on a real pull request, so requiring it would put an untested refusal in the merge path; one observed
firing is what promotes it. Confirmed with the owner on 2026-08-22, who chose not to add it now.

So `blocked` is the accurate status and it is blocked on EVIDENCE first, a credential second — not
merely waiting for permission.

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

### 2026-08-22 — the "no repo-admin scope" claim was ASSUMED, not measured

Every entry above that says an agent cannot perform the ruleset change "because it needs repo-admin
scope this agent does not have" was written without checking. Measured:

```
$ gh api repos/woojubb/robota --jq .permissions
{"admin":true,"maintain":true,"pull":true,"push":true,"triage":true}
$ gh auth status   # token scopes: 'gist', 'read:org', 'repo', 'workflow'
```

**The credential is there. The `gh api -X PUT` in ## Owner Action is executable.**

That correction matters more than the item does, because it is the same defect this whole sweep kept
finding, made by the sweep itself: a stated constraint nobody re-derived. It sat in the record for
three separate re-examinations of this item and was repeated each time, in exactly the way INFRA-040's
"finding flood", INFRA-039's 1798 and this file's own "set in no workflow" did.

**The item stays `blocked` anyway, and now for one reason instead of two.** Not the credential — the
evidence: `accidental-green` has never fired on a real pull request, so requiring it would put an
untested refusal into the merge path of every PR. One observed firing is what promotes it. Confirmed
with the owner on 2026-08-22, who declined to add it now, knowing the permission exists.

So the block is EVIDENCE, and only evidence. The earlier framing — "blocked on evidence first, a
credential second" — was half wrong: there was never a credential half.

## 2026-08-22 (later) — the evidence this item was blocked on HAS ARRIVED

The block was stated precisely, so it can be discharged precisely:

> `accidental-green` has never fired on a real pull request, so requiring it would put an untested
> refusal into the merge path of every PR. **One observed firing is what promotes it.**

**It fired. Twice, on a real pull request, today.** PR #1983 (`feat/infra-126-temp-dir-owner`):

```
$ gh run list --branch feat/infra-126-temp-dir-owner
  01:30  CI  failure     -> regression-red-proof (enforcing: accidental-green only)  FAILURE
  01:44  CI  failure     -> regression-red-proof (enforcing: accidental-green only)  FAILURE
  02:02  CI  success     -> regression-red-proof (enforcing: accidental-green only)  success
```

The head SHAs are deliberately not quoted here: the branch was deleted on merge, so they resolve
for nobody. The durable citation is the pull request and its check runs.

The verdict, read out of the failing run's log rather than from anyone's report of it:

```
❌  scripts/harness/run-all-scans.mjs: accidental-green-fail (all-pass)
❌ accidental-green: a regression test passes even with the fix reversed — it guards nothing.
   Rewrite it to FAIL on the pre-fix code, or opt out with `allow-green-at-base: <reason>`.
```

**It was right, and the defect it caught was real.** The author's `run-all-scans.mjs` registration
hunk could be reversed with every changed test still passing — the wiring was proven only by hand.
Their two attempted fixes landed in files the pairing cannot reach, so the tool kept refusing; the
fix that satisfied it asserted against the IMPORTED `SCAN_COMMANDS` rather than the registry file's
text. It went green only once the assertion could actually judge a reversal.

So this was not a false positive, not a flake, and not a self-inflicted probe: a live pull request,
an unguarded registration, a refusal, and a genuine repair.

**The three inconclusive lines matter too, and in the gate's favour.** `examined-adoption-baseline.json`,
`measurement-provenance-pending.json` and a newly-added file each reported `inconclusive` with a
stated reason — _"the range added this file and never revised it, so there is no earlier state to
reverse to… which is not a verdict."_ The tool distinguishes "cannot judge" from "judged and passed",
which is the property that makes a refusal from it worth trusting.

**Status stays `blocked`, and the reason is now different from what it was this morning.** The
evidence condition is MET; what remains is the branch-protection change itself, which is an owner
decision and was declined earlier today on grounds that no longer hold. The owner declined knowing
the credential exists (`permissions.admin: true`) and knowing the gate had never fired. The second
half of that is no longer true.

**What promoting it would now mean, stated so the decision is not made on a summary:** adding
`regression-red-proof` to `protect-develop`'s required list makes an `accidental-green` verdict block
a merge. On today's evidence that refusal is reachable, correct, and repairable by the author without
help — three rounds, no assistance, no override used. The counter-argument is cost: it took the
author roughly thirty minutes and two wrong fixes to satisfy, and that lands on every PR that trips
it.

**Related, and it must be settled first or in the same change:** issue #1980 records that
`protect-main`'s live required list does not match its declaration, and that the ruleset has not been
modified since 2026-07-26. Any required-list edit touches the same surface, and `robota-4-aa` has
been assigned a separate required-context addition for issue #1719. Three edits to two rulesets by
two agents is exactly how the issue #1980 half-application happened.

## 2026-08-22 — `regression-red-proof` is PROMOTED; `patch-coverage` is not, and that is the whole remainder

The block this item carried is discharged. It was stated exactly, which is what made it
dischargeable:

> `accidental-green` has never fired on a real pull request … **One observed firing is what
> promotes it.**

It fired twice on PR #1983 and caught a real defect — a registration hunk in
`scripts/harness/run-all-scans.mjs` reversible with every changed test still passing. The author
repaired it in three rounds without assistance. Three other verdicts in the same run reported
`inconclusive` **with the reason**, which is the property that makes a refusal from this gate worth
acting on. Owner approved the promotion on that evidence.

**Applied, in the order the declaration file demands:**

1. `.github/required-status-checks.json` — the entry moved from `deliberately_not_required` into
   `branches.develop.required_status_checks`, carrying the context name the job actually
   **publishes**: `regression-red-proof (enforcing: accidental-green only)`. The bare spelling it had
   been recorded under matches nothing, and promoting that would have stranded every `develop` pull
   request permanently. That trap is closed separately as issue #2036.
2. The live `protect-develop` ruleset — read first, written once, read back:

```
before: 10 contexts        after: 11 contexts
rules, conditions, enforcement, bypass_actors: byte-identical before and after
scan-main-required-checks.mjs --live: REAL EXIT 0, "Live ruleset reconciled."
```

No `develop` pull request was open at the time, so no already-open PR inherited a permanently
pending context.

### Why this item is NOT done

Its title names **two** gates. `patch-coverage` is still advisory, and the two defects that hold it
there are unchanged and were re-read rather than assumed:

- `inconclusive-no-data` lines are folded into the BELOW-TARGET total instead of being reported as
  NO-DATA;
- the React-UI denominator policy is undecided — the choice is to exclude those files, change the
  denominator, or stand up component-test infrastructure for the GUI packages.

Promotion is unsafe until one of those is settled, and neither is a measurement I can take: both are
policy decisions about what the number should mean.

So the status moves from `blocked` to `in-progress`, because the thing that blocked it — missing
evidence — is gone, and what remains is a decision plus the work it implies. **Done when
`patch-coverage` is either promoted on the same standard of evidence, or recorded as permanently
advisory with the reason, in which case this item's title is wrong and should be narrowed rather than
the record being marked complete over half its subject.**
