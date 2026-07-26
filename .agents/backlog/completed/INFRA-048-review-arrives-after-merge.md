---
title: 'INFRA-048: PRs can merge before their review feedback is ever read'
status: done
completed: 2026-07-26
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

**It is a recurring window, not a one-off.** The condition opens whenever that file changes on
`develop`, and closes silently on the next develop→main promotion. It closed mid-investigation: the
routine promotion #1427 merged at `2026-07-25T17:27:54Z`, carrying `@v7` to `main`, which restored
parity by itself. Nothing announced either edge. That is exactly why the fix is a scan rather than a
one-line correction — the drift will recur on the next workflow edit, and only a mechanical check
makes the window visible while it is open.

## Decision

Three levers were on the table (the original item's options 1–3). What shipped, and why.

**Chosen — a distinct blocking check that READS the review output, with a severity split.**

1. **`review-workflow-parity` scan** (`scripts/harness/scan-review-workflow-parity.mjs`, registered
   in `run-all-scans` → runs inside the REQUIRED `scans` job). Every workflow that invokes
   `anthropics/claude-code-action` must match the default branch's copy exactly; drift fails the
   scan with the reason. Governed workflows are discovered by the action they invoke, never by a
   hardcoded filename. FAIL-CLOSED: if the default branch's copy cannot be read, the scan fails. Not
   applicable on a PR whose base IS the default branch — that PR is the promotion which restores
   parity. The scan caught the drift twice during this work: once against the original `@v7`/`@v4`
   split, and once again the other way after #1427 landed `@v7` on `main` mid-session. This PR
   carries no net change to that workflow — the correction it needs is the guard, not the byte.

2. **`review-gate` check** (`.github/workflows/review-gate.yml` + the pure, unit-tested decision
   module `scripts/harness/check-review-gate.mjs`). It waits for the code-scanning analysis of the
   PR head, reads the alerts for the PR ref and for the base branch, and decides:

   | class          | rule                                                            | blocks?                         |
   | -------------- | --------------------------------------------------------------- | ------------------------------- |
   | blocking       | introduced by this PR, severity `error` or security high/crit   | **yes**                         |
   | advisory       | any other alert introduced by this PR                           | no, but printed on the check    |
   | pre-existing   | already open on the base branch                                 | no                              |
   | unavailable    | no analysis record, analysis incomplete, API error, unparseable | **yes**                         |
   | not-applicable | the `changes` classifier says this PR changes no code           | no (added by Defect 2, below)   |
   | acknowledged   | PR carries `review-findings-acknowledged`                       | no, override recorded on the PR |

   On a block it also runs `gh pr merge --disable-auto`, because a red **non-required** check does
   not stop an armed auto-merge — which is precisely the #1409 hole. The disarm is the lever that
   works today; the ruleset entry (below) is the durable one.

   **A fail-CLOSED caught in the gate itself, live — and it cost the ruleset entry.** See
   "Defect 2" below. The `unavailable` row above is now three rows: an analysis that exists and
   could not be read still blocks, and an analysis that was never owed passes as `not-applicable`.

   **A fail-open caught in the gate itself, live.** On the first run (#1434) the alerts query
   returned **0** for the PR ref while `develop` carried 100 — and the gate reported `PASS (clean)`.
   The zero turned out to be genuine (CodeQL's PR analyses are diff-informed: `results_count = 0` on
   `refs/pull/1434/merge`), but the gate had no way to know that: the alerts endpoint answers `[]`
   both for "analysed and clean" and for "never analysed". Same conflation, one level down. The
   Collect step now checks the analysis RECORD first (`/code-scanning/analyses?ref=refs/pull/N/merge`)
   and writes the `UNAVAILABLE` sentinel when none exists, so an empty list can only mean a real
   result.

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

**Parity — against the real repository, in both drift directions, on the live tree:**

```
RED    (develop @v7 vs main @v4 — the state at the start of this work)
       review-workflow-parity scan failed (INFRA-048):
         - .github/workflows/claude-code-review.yml: differs from origin/main. … skips the review
           and exits 0 — the check reports `success` having reviewed nothing.           EXIT=1
GREEN  review-workflow-parity scan passed … match origin/main.                          EXIT=0

RED    (again, unprompted: #1427 landed @v7 on main at 17:27:54Z, so the tree drifted the OTHER
        way and the scan re-fired — the same finding, opposite direction)                EXIT=1
GREEN  re-synced to the current default branch                                           EXIT=0
```

The second RED was not staged. It is the guard catching a real, live drift mid-session — the
recurrence this scan exists to make visible.

**The gate.** The `Decide` step body is EXTRACTED from `review-gate.yml` itself and run under
GitHub's `bash -e -o pipefail` semantics with `gh` stubbed. Before: `develop` has no `review-gate`
workflow at all, so the merge decision sees no review signal.

```
BLOCKING finding (error / security:high)
  review-gate: BLOCK (blocking-findings)
    - js/incomplete-sanitization [error/security:high] packages/agent-core/src/sanitize.ts:42 <!-- evidence-superseded: synthetic fixture output, not a repo path — this block is the gate's own stubbed-gh proof run, alongside the fictional PR number 9999 -->
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

**The gate, live on a real runner** (#1434, run `30168092423`, 3 m 32 s):

```
code-scanning analyses: 0/1 completed      <- polled; "not analysed yet" is never read as "clean"
… (11 polls, 20 s apart) …
code-scanning analyses: 1/1 completed
review-gate: PASS (clean)
no findings introduced by this PR.
```

So the check exists, waits for the analysis, and decides — where before there was no review signal
on the merge decision at all.

## Defect 2 — the gate blocked a docs-only PR, and the ruleset entry was rolled back

**Measured on #1436** (2026-07-26), the very next PR after `review-gate` was added to
`protect-develop`'s required status checks. #1436 is **one added backlog markdown file
(`.agents/backlog/INFRA-053-…md`, +80/−0) and nothing else** — zero code. It was BLOCKED. The gate's
own log:

```
code-scanning analyses recorded for refs/pull/1436/merge: 0
analysis_complete: false
review-gate: BLOCK (verdict-unavailable)
```

Runtime **15 m 23 s**, almost all of it the "Wait for the code-scanning analysis of this PR" step
polling for an analysis that was never going to arrive. The required-check entry was rolled back the
same day to unblock the repository, so the gate is advisory again.

**Root cause: a third state read as the second.** The hardening above was right — an empty alerts
list must not read as "clean", because the endpoint answers `[]` both for "analysed and clean" and
for "never analysed". But the fix collapsed a THIRD state into the same bucket: _no analysis exists
because there was no code to analyse_. `codeql.yml` carries `paths-ignore: ['**/*.md', '**/*.mdx',
'docs/**', 'content/**']`, so a docs-only PR never triggers CodeQL and no analysis record is ever
written for it. **"Not applicable" is not "unreadable."** One means the answer does not exist and
was never owed; the other means the answer exists and could not be read. Only the second is a
reason to block.

This is the same shape as the defect this item exists to fix, mirrored: INFRA-048's original defect
was a check reporting a verdict it had not computed; this one is a check demanding a verdict that
was never owed. Fail-closed is correct when the answer is missing; it is not correct when there is
no question.

### The fix

**1. One classifier, two callers — the "no code changed" determination is not re-derived.** The
review gate could not be allowed its own notion of "docs-only": any weaker rule would BE the bypass,
since a PR satisfying it skips the gate entirely. So `ci.yml`'s `changes` job — the mechanism this
repository already trusts to decide whether the required build/test matrix runs, hardened by
INFRA-050 to read merge-base history over complete ancestry — was extracted verbatim in behaviour
into `scripts/harness/classify-changed-paths.mjs`, and BOTH workflows now invoke it. `ci.yml` is
touched for exactly this reason and no other: sharing the mechanism is the requirement, and two
copies of a classifier are two classifiers.

Consequence, which is the point: **a PR can only be treated as not-applicable by the same
classification that also skipped its entire code pipeline.** A code PR cannot satisfy one without
satisfying the other. Behaviour-identity with the previous inline body was verified differentially
over real refs (#1436 and seven others — all `same`).

**2. Fail-closed survives, at both layers.** Every undeterminable case in the classifier — no merge
base, a failed `git diff`, an empty file list — answers `code=true`. And in the decision module,
only the literal `false` selects not-applicable: a missing flag, an empty value, `'False'`,
`'unknown'` all take the normal path and block on a missing analysis. The classify step also forced
`review-gate.yml` from `fetch-depth: 1` to `fetch-depth: 0`, because a grafted ancestry would make
the merge-base read fail — which, being fail-closed, would send every docs-only PR straight back
into the 15-minute wait (INFRA-050's guard catches this mechanically via `ci-base-history`).

**3. The wait, cut — without ever assuming success on a timeout.** Two things were conflated in one
15-minute deadline. They are now separate:

- A docs-only PR does not wait at all: the Wait and Collect steps are `if:`-gated on the classifier,
  so the gate answers immediately.
- **GRACE (5 min):** no `Analyze` check run has been created AT ALL. CodeQL's check runs appear
  within seconds of the PR event, so after five minutes the honest conclusion for a PR that does
  contain code is that no analysis was scheduled. This exit writes `analysis_complete=false` exactly
  like the long timeout and the gate BLOCKS — it only stops the job spending another ten minutes to
  reach the same answer.
- **DEADLINE (15 min):** an analysis exists and is still running. That is worth waiting for, and the
  loop still breaks the moment it completes (#1434 did so in 3 m 32 s).

Neither exit can pass. The only way out of the loop with `analysis_complete=true` remains "every
`Analyze` check run completed".

### Red / green / no-regression

Produced by EXTRACTING the step bodies from `review-gate.yml` itself and running them under GitHub's
`bash -e -o pipefail` semantics with `gh` stubbed and a virtual clock (20 s per poll, `sleep` a
no-op), the same method as the transcripts above.

```
RED — a docs-only PR under the config that blocked #1436 (the pre-fix workflow, unmodified)
  code-scanning analyses: 0/0 completed        <- x45
  ::error::review-gate: the code-scanning analysis for … did not complete within 15 minutes.
      [waited 920s]
  code-scanning analyses recorded for refs/pull/1436/merge: 0
  review-gate: BLOCK (verdict-unavailable)
  [gh] pr merge --disable-auto 1436                                            STEP EXIT=1

GREEN — the same docs-only PR after the fix
  === `changes` classifier verdict for this PR: code=false
  Wait …    SKIPPED by `if: steps.classify.outputs.code == 'true'` — no code changed.
      [waited 0s]
  Collect … SKIPPED by `if: steps.classify.outputs.code == 'true'` — no code changed.
  review-gate: PASS (not-applicable)
  no code changed — this PR touches documentation only, so CodeQL never analyses it and no
  review verdict exists to read. Nothing was skipped: the same classification also skipped
  this PR's build and test matrix. A PR that changes code cannot reach this outcome.
                                                                               STEP EXIT=0

NO REGRESSION — a code PR whose analysis is genuinely missing
  === `changes` classifier verdict for this PR: code=true
  code-scanning analyses: 0/0 completed        <- x15, then the new grace cut
  ::error::review-gate: no code-scanning analysis was scheduled for … within 5 minutes, and this
  PR changes code. Nothing has been analysed, so nothing has been cleared.
      [waited 320s]                            <- was 920s; still BLOCKS
  review-gate: BLOCK (verdict-unavailable)
  [gh] pr merge --disable-auto 1436                                            STEP EXIT=1

NO REGRESSION — a code PR that introduces an `error`-severity finding
  === `changes` classifier verdict for this PR: code=true
  code-scanning analyses: 1/1 completed        [waited 20s]
  review-gate: BLOCK (blocking-findings)
    - js/incomplete-sanitization [error/security:high] packages/agent-core/src/sanitize.ts:42
  [gh] pr merge --disable-auto 1436            <- auto-merge disarmed              STEP EXIT=1
```

The classifier's verdict on the real #1436 ref, from the real repository:

```
$ node scripts/harness/classify-changed-paths.mjs --base-ref origin/develop --head pr1436
merge base(s) vs origin/develop:
  95cf8e1524bb2cad5a2580dd7db875af83d17473
changed files:
  .agents/backlog/INFRA-053-review-turn-budget-and-parity-window.md
→ docs-only PR: no analyzable code changed.
code=false
```

## Test Plan

- `scripts/harness/__tests__/check-review-gate.test.mjs` — 30 tests: the severity split (note and
  warning never block; error and security-high/critical do), pre-existing-on-base exclusion,
  fixed/closed alerts ignored, both fail-closed paths (sentinel and unparseable payload), the
  acknowledge override and its recording, the CLI shape the workflow calls, and (Defect 2) the
  not-applicable path — a docs-only PR passes without reading alert files that were never written,
  a code PR's `error` finding still blocks, and every non-`false` classification value
  (`undefined`, `null`, `'false'` the string, `0`, `''`, `'unknown'`, `'False'`) fails closed onto
  `verdict-unavailable`. The not-applicable case was proven RED against the pre-fix module first
  (`expected true to be false` on `decision.blocked`).
- `scripts/harness/__tests__/classify-changed-paths.test.mjs` — 11 tests: the #1436 markdown-only
  shape, one code file among many docs files, workflow/harness-script changes as code, and the
  fail-closed trio (no merge base, failed diff, empty list). Plus an **anti-drift parity test**:
  `DOCS_ONLY_GLOBS` must equal `codeql.yml`'s `paths-ignore` entry for entry. That equivalence is
  what makes "docs-only" a sound predictor of "no analysis will ever exist"; if `paths-ignore` ever
  shrank without this list following, an analysed PR would be waved through as not-applicable.
- Differential check (agent-run, real refs): the extracted classifier vs the previous inline
  `changes` body over `pr1436`, `HEAD`, `origin/develop~{1,2,3,5,8}` and `origin/main` — all `same`.
- `scripts/harness/__tests__/scan-review-workflow-parity.test.mjs` — 7 tests: action-based
  discovery, one-line drift (the exact `checkout@v4`→`@v7` shape), byte-identity, fail-closed when
  the default branch is unresolvable, workflow absent from the default branch, promotion-PR
  non-applicability, and the live repository.
- YAML parse + `bash -n` on every `run:` block of all three workflows touched
  (`review-gate.yml` 4/4, `ci.yml` 44/44).
- `pnpm harness:verify-like-ci` (all five stages), `pnpm harness:scan` (64/64) and
  `pnpm harness:test` (80 files, 900 tests) — green.

## User Execution Test Scenarios

Not applicable as a product surface: this changes CI gating only, with no user-facing command or UI
behaviour. The equivalent agent-run evidence is the transcripts above, each produced by running the
real step body / the real scan against the real repository or a purpose-built fixture.

## Remaining step (why this item is not yet closed)

**Re-add `review-gate` to the `protect-develop` ruleset's required status checks — but not yet.**
Until then a red `review-gate` does not by itself stop a _manual_ merge; only the auto-merge path is
covered, by the disarm.

It was added once and rolled back within one PR. The entry itself was not the mistake — **the
mistake was arming it after observing the gate on exactly one PR (#1434, a code PR), which is a
sample that cannot contain the case that broke it.** A gate is required-ready when it has been
watched across the KINDS of PR the repository actually produces, not after N runs.

### Precondition status, measured 2026-07-26 — 4 of 5 hold, and the 5th does not

Checked against the actual check runs, not against this document's prose. **Four preconditions are
met; precondition 5 is NOT, and it is a one-command fix.** The ruleset itself was deliberately left
untouched — arming it is the owner's call, not the reconciling agent's.

| #   | Precondition                                     | Verdict     | Evidence                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Defect-2 fix on `develop`, gate producing checks | **MET**     | [#1439](https://github.com/woojubb/robota/pull/1439) merged `2026-07-25T18:49:52Z`; `gh run list --workflow=review-gate.yml` shows a run on every PR since                                                                                                                                                                                     |
| 2a  | observed on a **docs-only** PR                   | **MET**     | #1441, #1444, #1449 — all `PASS (not-applicable)`. Run `30172414912` (#1449): `code=false` → `review-gate: PASS (not-applicable)`, total **1m** and the Wait/Collect steps `skipped`, i.e. "a checkout, not minutes"                                                                                                                           |
| 2b  | observed on a **code** PR                        | **MET**     | #1451 (`3m19s`), #1452 (`3m56s`), #1453 (`3m22s`) — all pass, each ending on analysis COMPLETION, not a deadline                                                                                                                                                                                                                               |
| 2c  | observed on a **promotion** PR                   | **MET**     | #1458 (`release/promote-develop-to-main` → `main`), run `30182471881`, `4m44s`: `code=true`, the `refs/pull/N/merge` analysis was found and waited for, verdict computed. The shape "most likely to surprise" did not surprise.                                                                                                                |
| 3   | no spurious `verdict-unavailable` block          | **MET**     | The only two blocks in the whole window are #1451's runs `30173565727` and `30173813594`, and both are `BLOCK (blocking-findings)` — a real finding, not a missing verdict. Zero `verdict-unavailable` blocks occurred.                                                                                                                        |
| 4   | grace cut reasoned about against a real run      | **MET**     | Run `30173565727`: the `Analyze` check run already existed on the **first** poll (`code-scanning analyses: 0/1 completed` at `20:26:16`, i.e. `total=1`) and completed at `20:30:23` — 4m07s. The 5-minute grace covers "no check run created at all" and had margin from the first second; the 15-minute deadline had 11 minutes of headroom. |
| 5   | `review-findings-acknowledged` label exists      | **NOT MET** | `gh label list --limit 100` returns the 9 GitHub defaults only (`bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`). **The label does not exist on the repository.**                                                                                                      |

**The strongest single piece of evidence is #1451, and it was not staged.** The gate BLOCKED a real
code PR on a real high-severity finding and cleared only after the defect was fixed — run
`30173813594`:

```
review-gate: BLOCK (blocking-findings)
1 blocking finding(s) introduced by this PR (severity `error`, or security-severity high/critical).
Blocking findings introduced by this PR:
  - js/path-injection [error/security:high] packages/agent-cli/src/modes/serve-monitor-ui.ts:112
::error::review-gate blocked this PR. See the job summary.
```

That is SEC-006's R9 — the lexical containment check the triage had wrongly called a false positive.
Runs `30174467255`/`30174632780` on the same PR then passed after the canonical-path fix landed. So the
gate has now been observed doing the one thing that cannot be inferred from a green run: refusing a
merge, on a defect a careful human triage had already waved through, and then releasing it.

**The single remaining action, precisely:**

```bash
gh label create review-findings-acknowledged \
  --description "review-gate: findings acknowledged; merge with them on the record" --color BFD4F2
```

Precondition 5 is not decorative. Without the label the gate's only auditable override does not exist,
so the first inconvenient block would be resolved with an admin bypass — the exact failure mode this
design is calibrated against. Create it, confirm 1–4 still hold on the next PR of each shape, and only
then apply the ruleset change below.

### ARMED 2026-07-26 — all five preconditions measured

`review-gate` is a required status check on `protect-develop` as of 2026-07-26. Each precondition
was checked against real check runs, not reasoned about:

| #   | Precondition                                            | Evidence                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Defect-2 fix merged, gate producing checks on `develop` | #1439 merged; every PR since carries a `review-gate` check                                                                                                                                                                                                                                                                                                |
| 2a  | **docs-only** shape                                     | #1441, #1444, #1449, #1463 — `PASS (not-applicable)`; #1463 completed in **9 s**, the shape whose 15 m 23 s block forced the first rollback                                                                                                                                                                                                               |
| 2b  | **code** shape                                          | #1452, #1453, #1460 — verdict computed from a completed analysis, the wait ending on completion rather than on either deadline                                                                                                                                                                                                                            |
| 2c  | **promotion** shape (the untested one)                  | #1458 (`release/promote-develop-to-main` → `main`) — passed                                                                                                                                                                                                                                                                                               |
| 3   | no spurious `verdict-unavailable`                       | none observed across the above. The two blocks that did occur were both **genuine**: #1451 `js/path-injection` on `serve-monitor-ui.ts:112` (a lexical containment guard that a symlink walked straight through — the server really served an out-of-root file, `expected 200 to be 403`), and #1461 `js/insecure-temporary-file` ×3 in the demo recorder |
| 4   | grace cut reasoned against a real run                   | on #1439 the `Analyze` check run existed at the **first** poll (`0/1 completed`), so the 5-minute grace has ample margin                                                                                                                                                                                                                                  |
| 5   | escape hatch reachable                                  | `review-findings-acknowledged` **did not exist** — `gh label list` returned only the nine GitHub defaults. Created 2026-07-26. This was the genuinely missing precondition, and without it the first inconvenient block would have gone to an admin bypass                                                                                                |

**What the two real blocks establish is worth more than the passes.** The gate is not merely
tolerable when armed; it caught two exploitable defects that every other check reported green on,
and in both cases the authoring agent had initially classified the finding as a false positive.

The first arming attempt was rolled back the same day after being made required on a **one-PR
sample**, which could not contain the docs-only case that broke it. That is the lesson this table
exists to prevent repeating.

### Preconditions for making `review-gate` required again

All of these must hold. Each is checkable; none is a judgement call.

1. **The Defect-2 fix is merged to `develop`,** and `review-gate` is producing a check on PRs there.
   (A required check that does not exist on the base branch reports "expected" forever and blocks
   every open PR — INFRA-046's lesson, in the other direction.)
2. **The gate has been observed, while still ADVISORY, on all three PR shapes:**
   - a **docs-only** PR → expect `PASS (not-applicable)`, with the Wait/Collect steps `skipped` and
     a total runtime on the order of a checkout, not minutes;
   - a **code** PR → expect the analysis to be waited for and a real verdict computed
     (`clean` / `advisory-only` / `blocking-findings`), with the wait ending on completion rather
     than on either deadline;
   - a **promotion** PR (`develop` → `main`, or a `release/*` branch). This shape is untested and is
     the one most likely to surprise: its base is the default branch, its diff is large, and
     `review-workflow-parity` deliberately does not apply to it. Confirm what `refs/pull/N/merge`
     analyses and base-branch alerts look like when the base is `main` before trusting the verdict.
3. **No `verdict-unavailable` block on any of those three that turns out to be spurious.** A block
   is only acceptable evidence of health if the analysis was genuinely missing or unreadable. If one
   of the three blocks for a reason that is really "not applicable" or "not yet scheduled", that is
   a fourth state and it must be fixed before arming, not labelled around.
4. **The grace cut has been seen to fire, or been reasoned about against a real run.** Confirm from
   a live run log how quickly CodeQL's `Analyze` check run appears on a code PR; if it can
   legitimately take longer than the 5-minute grace on a busy runner queue, raise the grace rather
   than discover it as a false block after arming.
5. **An escape hatch is documented and reachable**: `review-findings-acknowledged` exists as a label
   on the repository, and whoever can merge knows it is the auditable override — otherwise the first
   inconvenient block gets resolved with an admin bypass, which is the failure mode this whole
   design is calibrated against.

Only then:

```bash
gh api repos/woojubb/robota/rulesets/18715844 --jq '.rules[] | select(.type=="required_status_checks")'
# then PUT the ruleset back with {"context":"review-gate"} appended to required_status_checks
```

And when arming: **watch the next PR of each shape**, and keep the rollback command to hand. The
cost of rolling back is one API call; the cost of leaving a wrong gate required is every open PR.

**Raise `--max-turns` on the review prompt — SPLIT OUT, no longer this item's remainder.** The whole
of the section below now belongs to [`INFRA-053`](INFRA-053-review-turn-budget-and-parity-window.md)
(`status: todo`, filed by [#1436](https://github.com/woojubb/robota/pull/1436)), which owns both the
turn budget and the parity window it depends on and measured the budget across #1434/#1435/#1436.
Kept here as the record of how it was discovered; do not track it from this item.

The parity fix
is confirmed live on the PR that carries it (#1434, run `30167624730`): the run log contains **zero**
`workflow validation` lines, where every earlier run had them. The reviewer really ran — for ~2
minutes instead of the previous 13–21 s — and then ended on

```
"subtype": "error_max_turns"
##[error]Execution failed: Reached maximum number of turns (25)
```

posting `No buffered inline comments`. So the check went from **green-and-empty** to
**red-and-honest**: the reviewer's turn budget is now the binding constraint, and it is visible.
That is the point of the parity fix — the constraint existed all along and was hidden behind a
`success`. A prompt that instructs the model to read `AGENTS.md` plus `.agents/rules/*` before
judging a diff does not fit in 25 turns on this repo.

Raising it means editing `claude-code-review.yml`, which the parity rule governs: the change must
land on `main` first (or in the same promotion), otherwise the reviewer goes straight back to
skipping. That constraint is inherent to the action, not to this scan — the scan only makes it
visible instead of silent. Nothing downstream depends on this: `review-gate` reads code-scanning
output, not the Claude review.
