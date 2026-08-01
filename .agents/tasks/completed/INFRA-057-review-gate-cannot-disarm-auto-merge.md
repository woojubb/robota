---
id: INFRA-057
title: review-gate's auto-merge disarm lacked the permission it needed, silently
status: done
priority: high
type: INFRA
created: 2026-07-26
completed: 2026-07-26
---

## Problem

`review-gate` blocks a PR by failing **and** calling `gh pr merge --disable-auto`. That second half
is INFRA-048's stated lever for the defect the whole gate exists to close:

> a red **non-required** check does not stop an armed auto-merge — which is precisely the #1409 hole.

Observed in the gate's own log on #1461, immediately after a genuine block:

```
GraphQL: Resource not accessible by integration (disablePullRequestAutoMerge)
auto-merge was not armed; nothing to disarm.
```

The lever had never once worked, and the log said the opposite.

## Finding 1 — the call really did fail on permissions, and the message is a catch-all

Both readings of that log were live: the message could be the `||` branch firing on a permission
denial, or it could be a genuinely-empty no-op printed next to an unrelated error. The step body
decides it, and it decides it against the benign reading:

```
gh pr merge --disable-auto "$PR_NUMBER" \
  || echo "auto-merge was not armed; nothing to disarm."
```

`||` fires on **any** non-zero exit. `gh` exits non-zero on the GraphQL 403, so the sentence printed
is unconditional on the failure path — it asserts a state it never checked. On #1461 the two lines
are **1.7 ms apart in the same step** (`03:05:38.3040361` and `03:05:38.3057561`), which is the `gh`
process and its own `||` branch, not two independent events.

Adjacency alone would not have settled it. **The armed-PR probe did** (below): with auto-merge
verifiably armed, the same two lines printed, and the auto-merge was still armed afterwards.

## Finding 2 — the gap is `contents`, not `pull-requests`, and a `permissions:` block does fix it

GitHub's auto-merge mutations (`enablePullRequestAutoMerge` / `disablePullRequestAutoMerge`) are a
**merge** capability: they need `contents: write` as well as `pull-requests: write`. The workflow
declared `contents: read`.

The decisive discriminator is in the same log, one second later: the gate's `gh pr comment` call
**succeeded** (`…/pull/1461#issuecomment-5081734269`). Same token, same step. So this was never "the
token has no write scope" — `pull-requests: write` was granted and working. The missing scope is
`contents`, and the answer to "can a workflow-level `permissions:` block grant it" is **yes**. It is
not a limitation of the default `GITHUB_TOKEN`.

One residual limitation is real and is now reported rather than hidden: on a **fork** PR GitHub
issues a read-only token whatever `permissions:` says, so the disarm cannot work there at all.

## Red-first — an armed auto-merge on a throwaway PR (#1465)

Not a log reading. Auto-merge was armed on a throwaway PR, the gate was forced onto its block path,
and the auto-merge state was read out-of-band before and after.

**RED — the pre-fix workflow** (run `30186393174`, PR #1465, auto-merge armed at `03:34:56Z`):

```
review-gate: PASS (clean)
PROBE auto-merge BEFORE: {"enabledAt":"2026-07-26T03:34:56Z","enabledBy":{"login":"woojubb"},"mergeMethod":"SQUASH"}
GraphQL: Resource not accessible by integration (disablePullRequestAutoMerge)
auto-merge was not armed; nothing to disarm.          <- FALSE. It was armed.
PROBE auto-merge AFTER:  {"enabledAt":"2026-07-26T03:34:56Z","enabledBy":{"login":"woojubb"},"mergeMethod":"SQUASH"}
https://github.com/woojubb/robota/pull/1465#issuecomment-5081827628   <- the comment posted fine
```

Identical `enabledAt` before and after: **the disarm changed nothing.** That is the lever INFRA-048
budgeted for, measured doing nothing, while reporting a clean no-op.

**GREEN — the fixed workflow, same PR, same armed auto-merge** (run `30186549458`):

```
review-gate         failure
disarm-auto-merge   success
  auto-merge was armed on this PR (state before: yes); disarming.
  auto-merge: DISARMED — the armed auto-merge on this PR has been removed.
  https://github.com/woojubb/robota/pull/1465#issuecomment-5081844918
```

Confirmed out-of-band, from outside the runner:

```
$ gh pr view 1465 --json autoMergeRequest --jq '.autoMergeRequest != null'
false
```

The PR never merged (`state: OPEN`, `merged: false`) and was closed with its branch deleted.

## Finding 3 — the three states are now decided by observation, not by an error string

`disarmed` / `nothing to disarm` / `not permitted` printed the same sentence, and only one of them
is benign. They are now separated by **reading the auto-merge state before and after the call**,
rather than by parsing `gh`'s exit code or stderr. That is deliberate: an error-string branch is
correct only for the failure modes someone enumerated, and it would still have been wrong on a fork
PR, an API outage, or a rate limit. Reading the state is correct for all of them, because the
question that matters is not "why did the call fail" but "is this PR still going to merge".

Produced by extracting the real `disarm-auto-merge` step body from `review-gate.yml` and running it
under GitHub's `bash -e -o pipefail` semantics with `gh` stubbed:

```
STATE 1 — auto-merge was never armed
  auto-merge: NOTHING TO DISARM — auto-merge was not armed on this PR.          STEP EXIT=0

STATE 2 — armed, and the disarm is permitted
  auto-merge was armed on this PR (state before: yes); disarming.
  auto-merge: DISARMED — the armed auto-merge on this PR has been removed.      STEP EXIT=0

STATE 3 — armed, and the disarm is NOT permitted (the #1461/#1465 shape)
  GraphQL: Resource not accessible by integration (disablePullRequestAutoMerge)
  ::error::review-gate: auto-merge is STILL ARMED on PR #1465 and could NOT be
  disarmed (gh exit 1, state after: yes). …                                     STEP EXIT=1

STATE 3' — armed, and the state cannot be re-read
  ::error::… (gh exit 1, state after: unknown). …                               STEP EXIT=1
```

`unknown` takes the failure path by construction: a state that could not be read is not a reason to
skip the disarm, and it is not a reason to report success.

## Decision — the disarm STAYS, in a job of its own

**Keep.** It is redundant on `develop`, where `review-gate` is a required check on `protect-develop`
and a red gate stops the merge by itself. It is not redundant on `main`: `protect-main` requires
`promotion ancestry` / `main PR source guard` / `release-grade verification` and **not**
`review-gate`, so on a promotion PR with auto-merge armed the disarm is the only automatic lever
there is. A required check can also be removed again — it already was once, on 2026-07-26, when the
gate blocked docs-only #1436. Now that the lever costs one working job instead of one broken line,
removing it would trade a proven mechanism for a revocable ruleset entry.

**Its limits, stated rather than assumed.** It is belt-and-braces, never the guarantee:

- It is inherently **racy on `main`**. `protect-main`'s three contexts can go green while this gate
  is still waiting on CodeQL, and auto-merge fires the moment they do. Only a required check is
  race-free.
- On a **fork** PR the token is read-only regardless, so the disarm reports STILL ARMED and fails.

**Separate job, not `contents: write` on the gate.** The gate job checks out the pull request and
executes scripts from it (`classify-changed-paths.mjs`, `github-api.mjs`). Granting a write token to
a job that runs PR-authored code is the standard supply-chain hole, and `permissions:` cannot be
scoped narrower than a job. `disarm-auto-merge` therefore checks nothing out and runs `gh` only, so
the write scope never meets PR-controlled code. It runs on `needs: review-gate` +
`needs.review-gate.result == 'failure'`, and goes RED itself when it cannot disarm.

## What carries the guarantee for PRs into `main`

Named explicitly, because the disarm does not:

1. **Today:** `protect-main`'s three required contexts — `promotion ancestry`, `main PR source
guard`, and `release-grade verification` (the only required context that executes the code on a
   promotion). `review-gate` is _deliberately_ not among them; the reasoning and the convergence
   condition are already recorded in `.github/required-status-checks.json` under
   `branches.main.deliberately_not_required` → "converge on `review-gate` … after it has been
   observed reporting a real conclusion on both a code and a docs-only promotion."
2. **The durable fix, and the owner's call:** add `review-gate` to `protect-main`'s required status
   checks. Prerequisite discovered here — INFRA-055's **R7** requires the `pull_request` trigger to
   declare `types:` including `edited`, and `review-gate.yml` currently declares
   `[opened, synchronize, reopened, labeled, unlabeled]`. Without `edited`, a PR retargeted onto
   `main` re-dispatches nothing (the #1442 shape). Add `edited` in the same change that arms it.
3. **Meanwhile:** the disarm, with the race and the fork caveat above, and now loud when it fails.

## Comment-posting permission — confirmed from real runs, not the manifest

`pull-requests: write` covers it, and both probe runs prove it end to end: the pre-fix run posted
`#issuecomment-5081827628` and the fixed run posted `#issuecomment-5081844918`, in the same step
whose auto-merge mutation was refused. A gate whose findings cannot be posted is the same failure
one level over; that path is healthy.

## The mechanical prevention

`scripts/harness/scan-automerge-disarm-permission.mjs`, registered in `run-all-scans` (so it runs in
the REQUIRED `scans` job). A lever believed to work and silently missing its scope is worse than a
missing one, and nothing in the pipeline could see the difference. Two rules:

1. A job performing an auto-merge mutation (`gh pr merge --auto` / `--disable-auto`,
   `enable`/`disablePullRequestAutoMerge`) must hold **both** `contents: write` and
   `pull-requests: write` in its EFFECTIVE permissions (job block if present, else workflow block —
   a job block REPLACES the workflow one). No declaration at all also fails: the repository default
   is a setting an administrator can flip, not a scope a merge lever may rest on.
2. In a `pull_request` / `pull_request_target` workflow, that job must not check the repository out
   — otherwise the write token and PR-authored code share a job.

**RED against the real pre-fix file** (not a hand-written fixture — `git show
e98bf73b5:.github/workflows/review-gate.yml`):

```
RED — the REAL pre-fix .github/workflows/review-gate.yml (commit e98bf73b5):
  - review-gate.yml › review-gate: performs an auto-merge mutation (gh pr merge --disable-auto)
    without `contents: write` in its effective permissions. …
  - review-gate.yml › review-gate: performs an auto-merge mutation … in a job that CHECKS THE
    REPOSITORY OUT, in a pull-request-triggered workflow. …
  findings: 2
GREEN — this working tree:
  findings: 0
```

## Acceptance

- [x] The three states are distinguishable in the gate's output — decided by observation, and a
      fourth (`unknown`) is reported rather than rounded down.
- [x] The disarm demonstrably works on an armed PR: #1465, armed at `03:34:56Z`, `armed: false`
      after run `30186549458`. What carries the `main` guarantee is named above regardless.

## Test Plan

- `scripts/harness/__tests__/scan-automerge-disarm-permission.test.mjs` — 18 tests: every mutation
  spelling, `--disable-auto` not read as the arming `--auto`, the mutation named in a comment not
  tripping the rule it documents, workflow→job permission fallback and job-level replacement, the
  `write-all`/`read-all` shorthands, a missing declaration failing closed, the pre-fix `review-gate`
  shape RED on both rules, the fixed shape GREEN, an _arming_ job flagged as well as a disarming
  one, a non-PR-triggered workflow allowed to check out alongside the mutation, silence on a
  repository that never touches auto-merge, and this repository.
- Agent-run three-state transcript from the extracted step body under `bash -e -o pipefail`
  (above), and the RED/GREEN scan run against the real pre-fix file from git history.
- Live agent-run red-first on PR #1465, both directions, with the auto-merge state read out-of-band.
- YAML parse + `bash -n` on all 5 `run:` blocks of `review-gate.yml`.
- `pnpm harness:scan` and `pnpm harness:verify-like-ci` — green.

## User Execution Test Scenarios

Not applicable as a product surface: this changes CI gating only, with no user-facing command or UI
behaviour. The equivalent agent-run evidence is the live #1465 probe above — the change was executed
on a real pull request, on real runners, and its effect read back from outside the runner.

## Follow-up filed elsewhere (not this item's remainder)

`.github/required-status-checks.json` does not declare `review-gate` under `branches.develop`,
although the live `protect-develop` ruleset now requires it. `node
scripts/harness/scan-main-required-checks.mjs --live` (scheduled by `ruleset-drift.yml`) reports:

```
review-gate: the LIVE `develop` ruleset requires it, but .github/required-status-checks.json does
not declare it under `branches.develop` — so nothing has checked that it is covered.
```

That declaration file is outside this change's ownership, and closing it also needs a
`ci-mirror-map.mjs` stage or an explicit un-mirrorable reason for `review-gate`. Reported, not
fixed here.

## References

- `.github/workflows/review-gate.yml` — the `disarm-auto-merge` job
- `scripts/harness/scan-automerge-disarm-permission.mjs` — the guard
- `.agents/tasks/INFRA-048-review-arrives-after-merge.md` — the design that relies on the disarm
- `.github/required-status-checks.json` — `branches.main.deliberately_not_required`
- #1409 (the original hole), #1461 (where the permission line was observed), #1465 (the throwaway
  probe, closed unmerged)
