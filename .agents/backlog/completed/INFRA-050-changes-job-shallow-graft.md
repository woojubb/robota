---
title: 'INFRA-050: the changes job uses a three-dot diff over a grafted history — can mis-skip code checks'
status: done
created: 2026-07-26
completed: 2026-07-26
priority: high
urgency: soon
area: .github/workflows/ci.yml, .github/workflows/gitleaks.yml, scripts/harness
depends_on: [INFRA-049]
---

# INFRA-050: a shallow graft can make a code PR skip required checks

## Problem

Found while fixing INFRA-049 (#1420). That fix established the mechanism: the workflow checks out
with `fetch-depth: 0` (or 50) and then runs `git fetch origin <base> --depth=50`, and **a `--depth`
fetch grafts the repository** — it records the boundary commits in `.git/shallow`, where git treats
them as parentless, so **every** later traversal stops there, on both sides of a range. Measured on
#1415: the same command over the same branch saw **109 commits locally vs 97 (a different set)** in
CI.

INFRA-049 fixed the `commitlint` job only. The `changes` job still carried the pattern — and it is
the job that decides whether the code-side matrix runs at all.

## Blast radius (measured, not assumed)

`tui-e2e`, `examples-typecheck` and `windows-shell` are **required status checks** on `develop`
(`gh api repos/woojubb/robota/rulesets/18715844` → build, quality, scans, security audit,
commitlint, tui-e2e, examples-typecheck, windows-shell) **and** they are gated on
`needs.changes.outputs.code == 'true'`. `changes` itself is **not** a required check.

So any outcome that leaves `code` unequal to `'true'` — a `code=false` verdict **or a failed
`changes` job**, which skips its dependents — makes those three required checks report `skipping`.
That branch protection accepts a skipped required check is not a theory here: **PR #1424 merged on
2026-07-25 with `tui-e2e`, `windows-shell` and `examples-typecheck` all reporting `skipping`.**

The bypass is therefore silent in both directions: nothing on the PR is red, and three required
checks never ran.

## Root cause, precisely

`git diff origin/<base>...HEAD` is a **merge-base** diff. Over a grafted ancestry the merge base
degrades in exactly two ways, and only two — this was measured, not reasoned:

| graft effect on the merge base  | consequence                             | direction   |
| ------------------------------- | --------------------------------------- | ----------- |
| resolves to an **older** commit | diff over-reports                       | fail-closed |
| **cannot be resolved**          | `fatal: … no merge base`, job exits 128 | **bypass**  |

A grafted merge base can never be _newer_ than the true one (truncation only removes candidates, it
never invents ancestry), so the three-dot diff cannot silently emit a smaller-but-successful file
list. What it does instead is **fail**, and a failed `changes` skips its dependents — landing on the
same silent bypass by a different route. See "Red / green evidence" for the measured threshold.

## Jobs that carried the pattern

Audited every job in every workflow. `.github/workflows/ci.yml` and `gitleaks.yml` were the only
files with base-relative history reads; `claude-code-review.yml`, `codeql.yml`,
`dependency-review.yml`, `deploy.yml`, `release-*.yml` and `security-scheduled.yml` have none.

| workflow › job                  | base-history read                                        | required? | before                        | after            |
| ------------------------------- | -------------------------------------------------------- | --------- | ----------------------------- | ---------------- |
| ci.yml › `changes`              | `git diff origin/<base>...HEAD`                          | no¹       | depth 50 + `--depth=50` fetch | `fetch-depth: 0` |
| ci.yml › `build`                | `harness:plan --base-ref origin/<base>`                  | **yes**   | depth 50 + `--depth=50` fetch | `fetch-depth: 0` |
| ci.yml › `quality`              | `harness:verify --base-ref origin/<base>`                | **yes**   | depth 50 + `--depth=50` fetch | `fetch-depth: 0` |
| ci.yml › `scans`                | `harness:scan` → `check-document-authority.mjs`          | **yes**   | depth 50                      | `fetch-depth: 0` |
| ci.yml › `security-audit`       | `git diff origin/<base>...HEAD`                          | **yes**   | depth 50 + `--depth=50` fetch | `fetch-depth: 0` |
| ci.yml › `release-grade-verify` | `harness:verify:release` → same scan gate                | main PRs  | depth 50                      | `fetch-depth: 0` |
| ci.yml › `regression-red-proof` | `check-regression-red-proof.mjs` (`git merge-base`)      | advisory  | depth 50 + `--depth=50` fetch | `fetch-depth: 0` |
| ci.yml › `patch-coverage`       | `check-patch-coverage.mjs` (`git diff -U0 <merge-base>`) | advisory  | depth 50 + `--depth=50` fetch | `fetch-depth: 0` |
| gitleaks.yml › `gitleaks`       | `--log-opts origin/<base>..HEAD`                         | no        | depth 50 + `--depth=50` fetch | `fetch-depth: 0` |
| ci.yml › `commitlint`           | `git rev-list --first-parent`                            | **yes**   | already fixed by INFRA-049    | unchanged        |

¹ `changes` is not itself required, which is precisely why its failure is silent.

Two of these were found by the guard, not by reading: **`scans`** and **`release-grade-verify`**.
Neither runs a `git` command that names the base — they invoke `pnpm harness:scan`, whose suite
contains `check-document-authority.mjs`, which diffs `origin/$GITHUB_BASE_REF...HEAD`. On a depth-50
checkout `origin/<base>` does not exist at all, so that scan performed **its own `--depth=50`
fetch** and then printed `SKIPPED … Not a pass` while the suite still exited 0. A required gate that
had quietly stopped enforcing.

`examples-typecheck`, `windows-shell` and `tui-e2e` read no history and keep their cheap
`fetch-depth: 50` — the proportional-CI design is preserved, not traded away.

## What changed

1. **Every depth-limited fetch is gone from `.github/workflows/**`.** `actions/checkout` with
   `fetch-depth: 0` fetches `+refs/heads/*` at full depth, so `origin/<base>` is already present and
   complete; the extra fetch was redundant _and_ was the graft. Measured cost of full history on
   this repo: **3.2 s**.
2. **`changes` and `security-audit` compute the merge base explicitly**, with `git merge-base --all`
   and a union over every base returned. A criss-cross history (this repo back-merges main ↔ develop)
   can have several merge bases, and `A...B` silently picks one; a union can only over-report.
3. **Both jobs now fail closed.** If no merge base exists, or the diff fails, they emit
   `code=true` / `changed=true` with a `::error::` annotation rather than exiting non-zero — because
   exiting non-zero is what skips the required checks. "Cannot classify" now means "run everything",
   which is also why an empty file list already classified as `code=true` and still does.
4. **A mechanical guard**, `scripts/harness/scan-ci-base-history.mjs`, registered in
   `run-all-scans.mjs` as `ci-base-history`. It bans depth-limited fetches in workflows outright and
   requires `fetch-depth: 0` on any job that reads base-relative history — detected both directly
   (`origin/<base>` as a revision, `--base-ref`, `--log-opts`, `git merge-base`, `git rev-list`) and
   indirectly, through a small table of script invocations whose backing script is re-verified to
   still read a base range (anti-rot: a stale entry fails the scan rather than guarding nothing).

## Red / green evidence

The step body is **extracted from `ci.yml` itself** (`origin/develop:` version for RED, working tree
for GREEN) and run under GitHub's `bash -e` semantics — not hand-copied. Fixture: a feature branch
forked far back carrying one source change plus one docs change, GitHub's synthetic
`refs/pull/1/merge`, and the base advanced 60 commits past that merge ref's first parent. The
checkout is materialised exactly as each config does it.

**RED — today's config, a real source change, `code` never set → the required checks skip.**

```
fatal: origin/develop...HEAD: no merge base
STEP EXIT=128
GITHUB_OUTPUT:                       <- empty; `needs.changes.outputs.code == 'true'` is FALSE
                                        => tui-e2e / examples-typecheck / windows-shell report
                                           `skipping`, which branch protection accepts (see #1424)
```

**GREEN — same fixture, same commits, fixed config.**

```
merge base(s) vs origin/develop:
fe2f70015bfb7bb7ee89a77c2bd1097515c8c8c7
changed files:
docs/a.md
packages/agent-core/src/index.ts
→ code changes present: full matrix runs.
STEP EXIT=0
GITHUB_OUTPUT: code=true
```

**NO REGRESSION — a genuinely docs-only PR still skips the heavy matrix.**

```
changed files:
docs/a.md
→ docs-only PR: heavy build/test/e2e jobs are skipped.
STEP EXIT=0
GITHUB_OUTPUT: code=false
```

**The threshold, swept.** Same fixture, only the distance the base advanced past the merge ref's
first parent varies. The cliff is exactly the fetch depth:

```
advance=0    today -> code=true     advance=50  today -> DIFF-FAILED (job red, dependents skip)
advance=10   today -> code=true     advance=55  today -> DIFF-FAILED
advance=40   today -> code=true     advance=80  today -> DIFF-FAILED
advance=48   today -> code=true     advance=0   fixed -> code=true
advance=49   today -> code=true     advance=50  fixed -> code=true
                                    advance=80  fixed -> code=true
```

**NO REGRESSION on real data.** The fixed step body replayed over the last 15 real PRs (base =
`M^1`, head = `M^2` for a merge commit / `M` for a squash — the same file set `changes` saw):

```
chore(deps): sync main's dependency majors into develop (#1415)   code=true   (9 files)
fix(ci): mirror the brace-expansion re-accept … (#1425)           code=true
docs(inventory): mark the invariant ledger provisional (#1424)    code=false
refactor(harness): HARNESS-049 extract publish.md's … (#1423)     code=false
docs(backlog): INFRA-050 … (#1422)                                code=false
fix(ci): INFRA-049 lint only the commits a PR authored (#1420)    code=true
docs(harness): HARNESS-049 phase 1 (#1421)                        code=false
docs: living harness-composition design (#1419)                   code=false
docs(skill): automated-review-convergence (#1418)                 code=false
docs(backlog): HARNESS-049 (#1417)                                code=false
fix(security): address CodeQL review findings (#1416)             code=true
docs(git): merged-branch cleanup (#1414)                          code=false
chore(deps): disable Dependabot (#1413)                           code=true
docs: read PR review output before arming auto-merge (#1412)      code=false
```

Every code PR classifies `code=true`, every docs PR `code=false`. The fix does not make every PR run
everything.

**The guard is red-first too.** `findBaseHistoryFindings()` run against the **pre-fix** workflows
restored from `origin/develop` reports **16 findings across 8 jobs** (the table above); against the
fixed tree it reports **0**. It does not flag `commitlint` (INFRA-049 already fixed it) nor
`examples-typecheck` / `windows-shell` / `tui-e2e` (no base-history read) — so it discriminates, it
does not just ban shallow checkouts.

## Test Plan

- `scripts/harness/__tests__/scan-ci-base-history.test.mjs` — 11 tests: job splitting, comment
  stripping (a comment _describing_ the banned pattern must not trip the guard — ci.yml's commitlint
  job contains one verbatim), signal discrimination (`if: github.base_ref != 'main'` is not a
  signal), grafted-vs-fixed job fixtures, a base-history job with no `fetch-depth`, and the
  anti-rot check against the real repository.
- `pnpm harness:verify-like-ci` (the full CI mirror) — green.
- YAML parse check on both modified workflows.

## User Execution Test Scenarios

Not applicable as a product surface: this changes CI gating only, with no user-facing command or UI
behaviour. The equivalent agent-run evidence is the three proofs above, each executed against the
real step bodies extracted from the workflow definitions, plus the 15-PR real-data replay.

## Local / CI divergence

Deliberately **not** given a new `verify-like-ci` stage. The stage table there mirrors CI _runtime
environments_ (a dist-free tree, the formatter, the self-test) — things a static check cannot
express. This defect is a property of the workflow **text**, so a scan is the right shape, and
`verify-like-ci`'s `scan-suite` stage already runs the whole `run-all-scans` suite: registering
`ci-base-history` there puts it in the local mirror, in CI's `scans` job, and in the pre-push path
at once, with no duplicated definition to drift. This closes the "no mechanical regression test"
residual INFRA-049 recorded.

## Residuals (not fixed here, deliberately)

- **`check-document-authority.mjs` still performs its own `git fetch --depth=50`** as a fallback
  when the base ref is missing, and still returns exit 0 on `SKIPPED … Not a pass`. Making every job
  that runs it check out at full depth means the fallback is never reached, so the graft is gone in
  practice — but the script-level fail-open remains. Same for `shared.mjs`'s `detectChangedFiles`,
  which returns `[]` (i.e. "verify nothing") when the base ref cannot be resolved. Both are harness
  scripts rather than workflow text; worth a follow-up item.
- **The gitleaks range is still two-dot** (`origin/<base>..HEAD`), so a back-merge re-scans commits
  already merged into the base. With complete history that is noise, not a miss — it over-scans.
- **Not reproduced end-to-end in live CI.** Everything above is measured locally against the real
  step bodies and real checkout shapes. What remains unproven by direct observation is only that a
  live GitHub runner behaves as the local reproduction does; the mechanism (`.git/shallow`
  truncation) and the acceptance of skipped required checks (#1424) are both directly measured.
