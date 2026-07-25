---
title: 'INFRA-048: PRs can merge before their review feedback is ever read'
status: in-progress
created: 2026-07-25
priority: high
urgency: soon
area: .github/workflows, scripts/harness, repo rulesets
depends_on: []
---

# INFRA-048: armed auto-merge outruns the review loop

## Problem

Observed on **#1409** (2026-07-25): CodeQL's inline review posted at `13:33:04Z`, the PR merged at
`13:34:18Z`, and the flagged defect — two unused imports in `scripts/perf/compare-typecheck.mjs` —
**landed on `develop`**. The fix had to be re-applied afterwards as #1410.

The reviews were not late. They arrived **74 seconds before** the merge. The failure is that **nothing
in the pipeline requires anyone to read them.**

Root cause: the required status checks that gate a merge are

```
build, quality, scans, security audit, commitlint, tui-e2e, examples-typecheck, windows-shell
```

(`protect-develop` ruleset). **Not one of them produces review feedback.** The two jobs that do —
`Claude review` and CodeQL's `Analyze (javascript-typescript)` — are advisory. So an armed auto-merge
fires the moment the eight gates go green, regardless of what the review jobs are about to say, or have
just said.

## What the investigation found on top of that

`Claude review` does not merely report `pass` regardless of findings. **It was not reviewing at all.**

`anthropics/claude-code-action` validates at run time that the workflow file invoking it is
BYTE-IDENTICAL to the copy on the repository's default branch. When it is not, it prints

```
Skipping action due to workflow validation: … must have identical content to the version on the
repository's default branch
Exiting due to workflow validation skip
```

and **exits 0** — so the job reports `success`.

`.github/workflows/claude-code-review.yml` on `develop` differed from `main` by exactly one line:
`actions/checkout@v7` vs `@v4`, a major-version bump merged to `develop` on 2026-07-24 (#1313) and
never promoted. Measured 2026-07-26:

| evidence                                                    | value                           |
| ----------------------------------------------------------- | ------------------------------- |
| `gh run list --workflow=claude-code-review.yml --limit 100` | `success: 100` (100 of 100)     |
| runs inspected in detail (#1432, #1423, #1421 PR runs)      | all three: validation skip      |
| run duration                                                | 13–21 s (no review is possible) |

So for every PR since 2026-07-24 the "review" check was green and empty. That is the INFRA-048 defect
in its purest form — a check reporting success for work it did not do — and it is invisible from
outside the run log.

## Decision

Three levers were on the table (the original item's options 1–3). What shipped, and why.

**Chosen — a distinct blocking check that READS the review output, with a severity split.**

1. **`review-workflow-parity` scan** (`scripts/harness/scan-review-workflow-parity.mjs`, registered
   in `run-all-scans` → runs inside the REQUIRED `scans` job). Every workflow that invokes
   `anthropics/claude-code-action` must match the default branch's copy exactly; drift fails the
   scan with the reason. Governed workflows are discovered by the action they invoke, never by a
   hardcoded filename. `.github/workflows/claude-code-review.yml` is restored to byte-identity, so
   the reviewer runs again. FAIL-CLOSED: if the default branch's copy cannot be read, the scan
   fails. Not applicable on a PR whose base IS the default branch — that PR is the promotion which
   restores parity.

2. **`review-gate` check** (`.github/workflows/review-gate.yml` + the pure, unit-tested decision
   module `scripts/harness/check-review-gate.mjs`). It waits for the code-scanning analysis of the
   PR head, reads the alerts for the PR ref and for the base branch, and decides:

   | class        | rule                                                          | blocks?                         |
   | ------------ | ------------------------------------------------------------- | ------------------------------- |
   | blocking     | introduced by this PR, severity `error` or security high/crit | **yes**                         |
   | advisory     | any other alert introduced by this PR                         | no, but printed on the check    |
   | pre-existing | already open on the base branch                               | no                              |
   | unavailable  | analysis incomplete, API error, unparseable payload           | **yes**                         |
   | acknowledged | PR carries `review-findings-acknowledged`                     | no, override recorded on the PR |

   On a block it also runs `gh pr merge --disable-auto`, because a red **non-required** check does
   not stop an armed auto-merge — which is precisely the #1409 hole. The disarm is the lever that
   works today; the ruleset entry (below) is the durable one.

**Why this design survives the NIT-bypass failure mode.** A gate that hard-fails on any review
finding blocks merges on NITs and gets routinely bypassed, which is worse than advisory — a bypassed
gate also teaches everyone to bypass. This repo makes the risk concrete and measurable: **every one
of its ~100 open code-scanning alerts is severity `note`** (mostly `js/unused-local-variable`), so a
"fail on any finding" gate would have been red on every PR from day one. Hence: only `error` /
security-high-or-critical findings that this PR INTRODUCES can block; everything else is printed and
counted on the check — visible where nothing was visible before — but never blocking. The single
escape hatch is a per-PR label whose application is a recorded act on the PR, rather than a blanket
admin bypass nobody can audit.

**Rejected.**

- _Hard-fail on any review finding._ The NIT trap above, with the repo's own alert corpus as
  evidence.
- _Make `Claude review` itself the blocking check._ Its verdict is model judgment, and — as measured
  here — it can report `success` without having run at all. A gate must be something whose execution
  is verifiable; that is why the parity scan (static, in a required job) is the floor and the gate
  reads a machine-produced artifact.
- _Make CodeQL's `Analyze` job required, on its own._ `Analyze` reports whether the ANALYSIS
  completed, not whether findings exist: on #1409 it was green while the finding was live. Requiring
  it guarantees the analysis ran, not that anyone read it.
- _Procedure only (the original option 3)._ Already landed as #1412 ("read PR review output before
  arming auto-merge"). Kept, but the recurring-mistake-prevention principle asks for a mechanical
  floor, and a procedure cannot be one.
- _#1409's own finding would still not block_ (severity `note`). Deliberate, and stated plainly: it
  is now REPORTED on the `review-gate` check where previously nothing was reported at all, and the
  procedural read step covers it. Blocking on it would recreate the bypass.

## Red / green evidence

**Parity — against the real repository:**

```
BEFORE  review-workflow-parity scan failed (INFRA-048):
          - .github/workflows/claude-code-review.yml: differs from origin/main. … skips the review
            and exits 0 — the check reports `success` having reviewed nothing.          EXIT=1
AFTER   review-workflow-parity scan passed: .github/workflows/claude-code-review.yml
          match origin/main.                                                            EXIT=0
```

**The gate.** The `Decide` step body is EXTRACTED from `review-gate.yml` itself and run under
GitHub's `bash -e -o pipefail` semantics with `gh` stubbed. Before: `develop` has no `review-gate`
workflow at all, so the merge decision sees no review signal.

```
BLOCKING finding (error / security:high)
  review-gate: BLOCK (blocking-findings)
    - js/incomplete-sanitization [error/security:high] packages/agent-core/src/sanitize.ts:42
  [gh] pr merge --disable-auto 9999
  ::error::review-gate blocked this PR.                                        STEP EXIT=1

NIT-level findings only (#1409's actual shape)
  review-gate: PASS (advisory-only)
  2 advisory finding(s) introduced by this PR — reported, not blocking.
    - js/unused-local-variable [note] scripts/perf/compare-typecheck.mjs:3
    - js/unused-local-variable [note] scripts/perf/compare-typecheck.mjs:4    STEP EXIT=0

error-severity alert ALREADY open on the base branch
  review-gate: PASS (clean) — 1 finding(s) already open on the base branch     STEP EXIT=0

analysis did not complete / alert list unreadable
  review-gate: BLOCK (verdict-unavailable)
  … This gate does not report a pass it did not compute …                      STEP EXIT=1

blocking finding + the acknowledge label
  review-gate: PASS (blocking-findings, acknowledged)
  OVERRIDDEN: … passes with the findings above on the record.                  STEP EXIT=0
```

Every case also writes the report to `$GITHUB_STEP_SUMMARY`, so the findings are on the PR's check
page rather than only in a log.

## Test Plan

- `scripts/harness/__tests__/check-review-gate.test.mjs` — 19 tests: the severity split (note and
  warning never block; error and security-high/critical do), pre-existing-on-base exclusion,
  fixed/closed alerts ignored, both fail-closed paths (sentinel and unparseable payload), the
  acknowledge override and its recording, and the CLI shape the workflow calls.
- `scripts/harness/__tests__/scan-review-workflow-parity.test.mjs` — 7 tests: action-based
  discovery, one-line drift (the exact `checkout@v4`→`@v7` shape), byte-identity, fail-closed when
  the default branch is unresolvable, workflow absent from the default branch, promotion-PR
  non-applicability, and the live repository.
- YAML parse + `bash -n` on every `run:` block of both workflows.
- `pnpm harness:verify-like-ci` (all five stages) and `pnpm harness:scan` — green.

## User Execution Test Scenarios

Not applicable as a product surface: this changes CI gating only, with no user-facing command or UI
behaviour. The equivalent agent-run evidence is the transcripts above, each produced by running the
real step body / the real scan against the real repository or a purpose-built fixture.

## Remaining step (why this item is not yet closed)

**Add `review-gate` to the `protect-develop` ruleset's required status checks.** Until then a red
`review-gate` does not by itself stop a _manual_ merge — only the auto-merge path is covered, by the
disarm. The entry cannot be added before this PR lands: a required check that does not yet exist on
`develop` reports "expected" forever and blocks every open PR (INFRA-046's "flip the flag AND add to
the ruleset" lesson, in the other direction).

After this PR is merged to `develop` and one PR has been observed producing a `review-gate` check:

```bash
gh api repos/woojubb/robota/rulesets/18715844 --jq '.rules[] | select(.type=="required_status_checks")'
# then PUT the ruleset back with {"context":"review-gate"} appended to required_status_checks
```

Also unobserved on a live runner: that the restored parity makes `Claude review` actually review.
The mechanism is directly measured (three run logs, the one-line diff, 100/100 `success`), and the
PR carrying this change is itself the first PR whose merge ref holds a file identical to `main`'s —
so its `Claude Code Review` run is the observation point.
