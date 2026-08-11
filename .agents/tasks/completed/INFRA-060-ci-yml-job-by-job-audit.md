---
title: 'INFRA-060: ci.yml job-by-job audit — three fail-open paths closed, four fidelity gaps filed'
status: done
completed: 2026-07-27
created: 2026-07-26
priority: high
urgency: now
area: .github/workflows/ci.yml, scripts/harness
depends_on: []
---

## Problem

`.github/workflows/ci.yml` carries 14 jobs and every required status check on `protect-develop`,
plus three of the four on `protect-main`. In two days it produced five separate incidents in which
a green check meant nothing (INFRA-048 `scans` exiting 0 on SKIPPED; INFRA-049/050 grafted history;
INFRA-055 vacuous `main` contexts; INFRA-056 `verify-like-ci`; INFRA-055 the `edited` retarget).
Each was fixed at its cause. Nobody had gone job by job asking the general question.

This item is that pass, on two axes per job:

- **Enforcement** — can this job actually go RED? A job not made to fail is a hypothesis.
- **Purpose fidelity** — does what it checks match what its context NAME claims? A green check that
  misleads the reader of the check list is the same deception as one that did nothing.

Method: falsify, not reason. Each `run:` body was extracted verbatim and executed under `bash -e`
with stubbed inputs, or its command run directly, the way INFRA-048 and INFRA-050 did their proofs.

## Per-job verdict

14 jobs (the brief said 13; the count is 14, confirmed by parsing `jobs:`).

| #   | Job (context)                                         | Required | Purpose a reader would infer                                      | Fidelity                                                     | Falsified?                                                                                                                      | Verdict                              |
| --- | ----------------------------------------------------- | -------- | ----------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | `main-pr-source-guard` (`main PR source guard`)       | main     | A PR to `main` comes from develop/release/hotfix in THIS repo     | matches                                                      | **yes** — 6 cases run under `bash -e`: develop✓, feature✗, fork-named-develop✗, release/*✓, empty head_ref✗                     | PASS                                 |
| 2   | `promotion-ancestry` (`promotion ancestry`)           | main     | The promotion carries `main`'s ancestry (INFRA-051 A1/A3)         | matches                                                      | **yes** — ran the scan with `GITHUB_BASE_REF=main` + a non-promotion head; exit 1 on A1                                         | PASS                                 |
| 3   | `changes`                                             | **no**   | Classifies the PR code vs docs-only                               | matches                                                      | **yes** — probe PR #1476 forced the job to fail and the consequence was measured (see D3)                                       | PASS, but see D3                     |
| 4   | `build`                                               | develop  | The monorepo builds                                               | matches after D4                                             | **yes** — see D4                                                                                                                | **DEFECT — FIXED**                   |
| 5   | `quality`                                             | develop  | The affected scopes' build/test/lint/typecheck pass               | matches after D4                                             | **yes** — see D4                                                                                                                | **DEFECT — FIXED**                   |
| 6   | `scans`                                               | develop  | The harness suite + full dist-independent scan suite pass         | matches                                                      | **yes** — run in verification, 70 scans + 1153 harness tests                                                                    | PASS, but see D6                     |
| 7   | `dependency-audit` (`dependency audit`)               | develop  | An OSV dependency scan over the lockfile, when a manifest changed | matches after D5 (was `security audit`)                      | **yes** — step extracted; unresolvable base ref correctly forces `changed=true`; regex verified on nested/lock/code-only inputs | ENFORCEMENT PASS, **D5 FIXED**       |
| 8   | `release-grade-verify` (`release-grade verification`) | main     | The FULL build/scan/test/typecheck/lint sweep                     | **over-claims** — `pnpm test` is `-r --if-present`           | partly — measured the 5 silently-skipped workspaces                                                                             | ENFORCEMENT PASS, D7 → **INFRA-063** |
| 9   | `commitlint`                                          | develop  | Every commit this PR authored is conventional                     | matches                                                      | **yes** — exited **0** on an unresolvable range                                                                                 | **DEFECT — FIXED**                   |
| 10  | `examples-typecheck`                                  | develop  | `examples/` typecheck against locally-built packages              | matches                                                      | **graph** measured (#1476: dispatched on a failed `changes`); internal failure path reasoned                                    | PASS after D3 fix                    |
| 11  | `windows-shell`                                       | develop  | Cross-platform shell execution verified on real Windows           | **step 1 over-reaches; both steps could pass on zero tests** | **yes** — a rename made it print `No test files found, exiting with code 0`                                                     | **DEFECT — FIXED**, plus D2 filed    |
| 12  | `tui-e2e`                                             | develop  | TUI PTY e2e against the built binary                              | matches                                                      | **graph** measured (#1476: dispatched on a failed `changes`); internal failure path reasoned                                    | PASS after D3 fix                    |
| 13  | `regression-red-proof (advisory)`                     | no       | Advisory — name says so                                           | matches (honest name)                                        | **graph** measured (#1476); internal path reasoned                                                                              | PASS                                 |
| 14  | `patch-coverage (advisory)`                           | no       | Advisory — name says so                                           | matches                                                      | **graph** measured (#1476); internal path reasoned                                                                              | PASS, but see D8                     |

**Falsified: 8 of 14** — jobs 1, 2, 3, 4, 5, 7, 9, 11, via seven local step-level proofs plus the
live probe PR #1476.
**Graph measured, internals reasoned: 4** — jobs 10, 12, 13, 14. The probe proves they are
DISPATCHED when `changes` fails; it does not prove each can go red on a broken TUI or a broken
example.
**Not falsified at all: 2** — `scans` (6) and the enforcement half of `release-grade verification`
(8). Both were RUN green, which is not the same as made to fail. Every non-falsified row is a
hypothesis and is marked as one.

## Defects

### D1 — `windows-shell` reported green on ZERO tests — **FIXED**

Both steps selected tests by name through the package `test` script, which is
`vitest run --passWithNoTests`. Renaming `platform-shell.test.ts` to `shell-resolver.test.ts`:

```
 RUN  v3.2.6 .../packages/agent-core
No test files found, exiting with code 0
filter: platform-shell
$ EXIT_CODE_WITH_ZERO_TESTS=0
```

The flag cannot be overridden at the call site — vitest's cac rejects the repeated flag
(`Expected a single value for option "--passWithNoTests", received [true, false]`). Fixed by
bypassing the script: `pnpm --filter <pkg> exec vitest run <pattern>`, which resolves the same
per-package config and exits 1 on zero matches (verified: 8 and 6 tests still collected; exit 1 on
a pattern matching nothing). Guarded by `test-selection-tolerance`.

### D2 — `windows-shell` step 1 over-reaches — **FILED, not changed**

`packages/agent-core/src/utils/platform-shell.test.ts` is a pure-function test:
`resolvePlatformShell(env, platform)` takes the platform as an ARGUMENT. It never reads
`process.platform` and spawns nothing, so its verdict on `windows-latest` is identical to its
verdict on Linux — proven by running it on Linux (8 passed). The job's stated reason ("these tests
exercise the win32 path that the macOS/Linux jobs cannot") is false for this half; it pays for the
matrix's most expensive runner to re-run a pure function `quality` already covers. Step 2
(`agent-tools`) DOES spawn a real shell and is genuinely win32-only — leave it.

Not changed here: removing a step from a required check changes what gates a merge.

### D3 — a red `changes` turned three REQUIRED checks into `skipped` — **FIXED**

`changes` is not a required check; `tui-e2e`, `examples-typecheck` and `windows-shell` are, and all
three `needs: changes`. GitHub reports a dependent as `skipped` when its dependency FAILS, and
branch protection accepts a skipped required check (INFRA-050) — the #1424 shape exactly.

INFRA-050 removed one CAUSE (the grafted fetch). The MECHANISM was untouched and reachable from
every other way the job can fail: checkout failure, runner OOM, a syntax error in the classifier, a
Node crash. `classify-changed-paths.mjs` cannot help — it always exits 0, so it can only classify
fail-safe, never protect against the job itself failing.

Fixed at all five dependents: `!cancelled()` disables GitHub's implicit `success()` over `needs`,
and a non-success `changes` is treated as CODE — the classifier's own rule. A cancelled run still
skips (superseded, not unverified). Guarded by `required-check-needs`.

**Measured on live CI, not asserted.** The fix's own failure branch cannot be exercised by this
item's PR — `changes` succeeds there — so throwaway PR #1476 forced the `changes` step to `exit 1`
_before_ writing `code=` to `$GITHUB_OUTPUT`, reproducing exactly what a checkout failure, a runner
OOM or a syntax error in the classifier produces (`result=failure`, empty `outputs.code`). The same
run contains its own control: the three main-only jobs, genuinely excluded by their `if:`, report
`skipping` — while the three REQUIRED dependents were DISPATCHED and reported real conclusions.

`gh api repos/woojubb/robota/actions/runs/30194961685/jobs` — the decisive form, because
`started_at` cannot be produced by a skipped job:

```
changes:            status=completed   conclusion=failure  started=2026-07-26T08:37:42Z
windows-shell:      status=in_progress conclusion=null     started=2026-07-26T08:37:52Z
tui-e2e:            status=in_progress conclusion=null     started=2026-07-26T08:37:53Z
examples-typecheck: status=in_progress conclusion=null     started=2026-07-26T08:37:51Z
```

All three REQUIRED dependents STARTED 9-11 seconds AFTER `changes` had already completed as
`failure` — i.e. GitHub evaluated the fail-safe `if:` against a failed dependency and dispatched
them. A skipped job has no `started_at` at all. The advisory pair (`patch-coverage`,
`regression-red-proof`) ran and passed on the same run, so all five dependents are covered.

The same run carries its own control — the three main-only jobs, genuinely excluded by their
`if:`, reported `skipping`:

```
main PR source guard          skipping   (control: genuinely if:-excluded)
promotion ancestry            skipping   (control)
release-grade verification    skipping   (control)
```

This is the property the whole fix rests on, and it is now the measured half of #1424: that
incident recorded the three contexts reporting `skipping`; this records the same three running.

### D4 — `build` and `quality` both green having done nothing, on a build-tooling PR — **FIXED**

**Reproduced first.** A one-line change to `scripts/build-types-ordered.mjs` — the second half of
root `pnpm build` — resolved to `scopes: []`:

```
$ pnpm harness:plan -- --base-ref origin/develop
Changed files: 1
Scopes:
- none
Repository checks: repository-review
$ node <the build job's Detect-build-requirement step>  →  required=false
$ pnpm harness:verify -- --base-ref origin/develop --skip-build --skip-record-check
No package or app scope detected from changed files.
$ echo $?  →  0
```

So `build` never ran `pnpm build`; `quality` verified zero scopes, skipped the binary e2e (gated on
`package_dist_required`) and ran `build-contracts` against no restored dist. Two REQUIRED checks,
both vacuous, on a PR that changes the build tooling itself. Real build coverage did exist — but it
was delivered by jobs named `tui-e2e` and `examples-typecheck`, which is the fidelity half.

**The fix is in the calculator, not in the gate.** "Fail when scopes is empty" was rejected: a
docs-only PR legitimately resolves to zero scopes, and reddening it is precisely why `review-gate`
was rolled back the day it was armed. The defect is that a PR changing the build tooling does not
affect zero packages — it affects **all** of them, and the calculator could not see that
dependency. `scripts/harness/check-plan.mjs` now declares
`WORKSPACE_WIDE_BUILD_TOOLING_PATHS`, and a change to any of them selects the FULL workspace with
`forceFullVerification`.

The membership rule, so the list can be extended without re-deriving it: **a repo-root path belongs
there when changing it changes the OUTCOME of `build` / `typecheck` / `lint` / `test` for scopes
that did not themselves change.** Eight entries, each with the evidence rather than the intuition:

| Path                              | Why every scope                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `scripts/build-types-ordered.mjs` | root `build` is `pnpm --filter "./packages/**" build:js && node scripts/build-types-ordered.mjs`                   |
| `package.json` (root)             | owns `build`/`typecheck`/`lint`/`test`, the toolchain `devDependencies`, `pnpm.overrides`, `engines`               |
| `pnpm-workspace.yaml`             | decides which directories ARE workspace packages at all                                                            |
| `tsconfig.base.json`              | extended by **80 of the 86** in-scope tsconfigs (counted, not assumed)                                             |
| `tsconfig.json`                   | root project references; `tsconfig.eslint.json` extends it                                                         |
| `tsconfig.eslint.json`            | extended by each package's own `tsconfig.eslint.json`, which its `.eslintrc.json` names as `parserOptions.project` |
| `.eslintrc.json`, `.eslintignore` | root `lint` is `eslint packages apps`; every package's config resolves through the root                            |

**After the fix**, the same branch:

```
$ pnpm harness:plan -- --base-ref origin/develop
Changed files: 1
Scope coverage: 86 of 86 workspace scopes (workspace-wide build tooling changed: scripts/build-types-ordered.mjs).
Scopes:
- apps/action: build, test, typecheck
… 86 rows …
$ node <the build job's Detect-build-requirement step>  →  required=true
```

**The docs-only path is unchanged, and that was checked, not assumed** — the over-correction is the
other failure mode, and a slow gate gets bypassed:

```
$ pnpm harness:plan -- --changed-file README.md
Scope coverage: 0 of 86 workspace scopes — this plan verifies NO package or app.
Scopes:
- none
$ echo $?  →  0     # still a PASS, as it must be
```

An ordinary package change is also untouched: `packages/agent-core/src/index.ts` still resolves to
55 of 86 (its owner plus its dependents), not 86.

**Second half — an empty scope set is now visible.** Zero scopes stays a pass, but it no longer
reads like a full one. Every plan states its coverage as a count, on stdout and in the GitHub **job
summary** (`$GITHUB_STEP_SUMMARY`, appended by the harness itself — no workflow change needed, so
this required no edit to `ci.yml`):

```
Scope coverage: 0 of 86 workspace scopes — this plan verifies NO package or app.
Scope coverage: 86 of 86 workspace scopes (workspace-wide build tooling changed: …).
```

`verify-change.mjs` prints and posts the same line BEFORE any check runs, including on its
zero-scope early return. A `neutral` conclusion was not attempted: it would require changing job
definitions in `ci.yml`, which this branch does not own.

**The sweep — is the class larger than the one instance?** Every path in the repo outside
`packages/` and `apps/` was classified through the calculator's own `classifyRepositoryChecks`
(1882 files land in `repository-review`, which has no executable check at all — that is D6's
territory, not a scope-selection defect). The candidates that could plausibly govern every scope
were then measured against 400 `develop` commits, and each was decided on the number:

| Candidate                                                                                           | Touched (of 371 commits with files) | Verdict                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/build-types-ordered.mjs`                                                                   | 0                                   | **added** — the audit's instance; never changed in 400 commits, so its cost is ~0                                                                                                                                                                                                                 |
| `package.json` (root)                                                                               | 23 (17 with no scope)               | **added**, unconditionally. A key-precise variant (only `devDependencies`/`pnpm`/`engines`/build scripts) would fire 14 rather than 23 — rejected: that key list is itself a rot surface, and 9 extra full verifications per 371 commits is the cheap direction of the error                      |
| `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `.eslintrc.json`                      | 0, 1, 2, 2                          | **added** — ~1.3% of commits combined                                                                                                                                                                                                                                                             |
| `tsconfig.eslint.json`, `.eslintignore`                                                             | 0, 0                                | **added** for closure with the two above                                                                                                                                                                                                                                                          |
| `pnpm-lock.yaml`                                                                                    | 41 (7 with no scope)                | **excluded, measured.** All 7 of the no-scope commits ALSO touched root `package.json`, so it adds no detection the list does not have; adding it would move the other 34 from partial to full verification for nothing                                                                           |
| `vitest.config.ts` (root)                                                                           | —                                   | **excluded, verified.** It does not govern a scope's `pnpm test` — vitest resolves config from the cwd and never searches upward. `packages/agent-tools` has no local vitest config and still collected 26 test files, which the root `include` (`packages/**/src/**`) cannot match from that cwd |
| `.prettierrc.json`, `commitlint.config.js`, `stryker.conf.mjs`, `.dependency-cruiser.cjs`, `.nvmrc` | —                                   | **excluded** — none is read by a scope's `build`/`test`/`lint`/`typecheck`                                                                                                                                                                                                                        |

So the class was larger than the one instance the audit found (8 paths, not 1), but it is bounded
and small: the added paths fire on roughly **5% of commits**, and 3 of the 8 have never been
touched in 400 commits. Two more candidates were measured and deliberately left out with the number
behind the decision, which is the part that will still be checkable in six months.

**Not swept, and named as such.** This looked only at paths that resolve to ZERO scopes when they
should resolve to many. The converse — a path that resolves to SOME scopes when it should resolve
to more — was not audited, and `mapFilesToScopes`'s prefix rule makes it plausible.

### D5 — `security audit` claimed more than it checked — **FIXED**, renamed `dependency audit`

The context name read as "this PR was audited for security". It is an OSV **dependency** scan over
`pnpm-lock.yaml`, gated on a manifest/lockfile diff. A PR adding a command injection, a leaked
credential or a permissive CORS policy gets a green check. The narrow gating is itself sound and
complemented by `security-scheduled.yml` (INFRA-044 part 2) — the defect was the NAME, and it is the
same deception as a green check that did nothing, wearing a different mask: the check list is what a
human reads when deciding whether a merge is safe.

`dependency audit` matches the behaviour exactly, and makes visible that the security surface is
covered by SEVERAL checks (CodeQL, `Secret scan (gitleaks)`, `Dependency review`, `review-gate`)
rather than by this one.

**The operational hazard, and how it was sequenced.** The context string is a required status check
on `protect-develop`, and branch protection matches on the job's `name:`. A required context that
does not exist reports `expected` forever and blocks every open PR. So the rename was held until the
PR queue was empty (verified 0 open PRs immediately before pushing) and split across two actors: this
PR lands the whole repository side, the owner PATCHes the ruleset's one context string. Between the
two, `main-required-checks --live` is expected to be RED — and it is, which is the point:

```
$ node scripts/harness/scan-main-required-checks.mjs --live
main-required-checks scan failed (INFRA-055):
  - security audit: the LIVE `develop` ruleset requires it, but .github/required-status-checks.json
    does not declare it under `branches.develop` — so nothing has checked that it is covered.
  - dependency audit: .github/required-status-checks.json declares it required on `develop`, but the
    LIVE ruleset does not require it — it is enforcing nothing.
```

A reconciler that stayed SILENT through a rename would not be reconciling. This one names the drift
in both directions.

**Which pins noticed, measured rather than assumed.** The failure mode of a rename is one reference
left behind, so each pin was run against a half-renamed tree instead of being trusted:

| Pin                                     | Noticed? | Evidence                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ci-mirror-map.test.mjs`                | **yes**  | With `ci-mirror-map` left on the old name it failed THREE ways: the develop context is required but unmirrored; `NOT_MIRRORED` declares a context nothing requires; and ci.yml's job `dependency-audit` runs steps no stage reproduces. Bidirectional, and it resolves `job:` → a real ci.yml job                        |
| `harness-scripts.test.mjs`              | **yes**  | Reads ci.yml and asserts the job id exists carrying a job-level `if:` — red when `security-audit` is gone                                                                                                                                                                                                                |
| `verify-like-ci.test.mjs`               | **yes**  | Three assertions pinned the context string, in `NOT_MIRRORED` and in the summary output                                                                                                                                                                                                                                  |
| `scan-main-required-checks` **offline** | **no**   | **Finding.** Its R1-R7 are quantified over `branches.main` only, so a `develop` context pointing at a job that no longer exists is invisible to it. Documented behaviour, not a bug — but it means the develop-side rename is guarded ENTIRELY by one test in `ci-mirror-map.test.mjs`, and by nothing in `harness:scan` |
| `scan-main-required-checks --live`      | **yes**  | Reconciles both branches; output above                                                                                                                                                                                                                                                                                   |

The row worth carrying forward is the fourth. `scan-main-required-checks` is the artefact whose name
and docstring make a reader expect it to cover this, and it does not; the coverage comes from a test
in a different file. Here that happened to be enough — which is luck, not design.

**Deliberate remaining mentions.** After the rename, `security audit` survives only in: CHANGELOG
entries; `.agents/spec-docs/done/**` and `.agents/tasks/completed/**` GATE records; the frozen
`INFRA-055-pre-correction.md.txt` fixture (a byte-for-byte reproduction of a historical document —
editing it would destroy the thing it exists to preserve); and a few `(then named …)` /
`Renamed from …` notes written so the old name still resolves for a reader of the history.

Two live references were **not** changed, being outside this branch's ownership:
`.github/workflows/dependency-review.yml:46` and `.github/workflows/security-scheduled.yml:3`, both
COMMENTS naming the job. Neither is a `needs:` edge nor a context pin, so nothing is broken by them —
but they are stale, and **INFRA-061** owns those two files.

`.agents/specs/verification-pipeline-plan.md` also still says `security-audit`, and is left alone on
purpose: it is a planning document ("No implementation is authorized by this document alone")
describing a PROPOSED pipeline — and its own description of that very row already reads "Run
**dependency audit** as an independent job". The plan named the job correctly; the implementation
shipped under a broader name. The over-claim entered at implementation time, not at design time, and
no gate compares the two.

**Kinship with HARNESS-053.** `scan-dist-freshness` was found in the same window to be a presence
gate wearing a temporal name — which is why `harness:scan` was green on precisely the tree that made
`typecheck` red. Same class: a name promising more than the behaviour delivers. That is three
instances in one audit window (D5, D7 → INFRA-063, HARNESS-053) on top of the four already tabulated
in `.agents/memory/check-validity-two-axes.md`. The durable output is that memory entry's rule:
**judge a check on two axes — can it fail, and does it check what its name promises — because green
on the first is routinely mistaken for both.**

### D6 — `run-all-scans` renders SKIPPED as ✓ — **FILED**

A scan that prints SKIPPED and exits 0 is counted as a pass in the `N of M scans passed` line.
`scan-promotion-ancestry.mjs` does exactly this on every develop PR (correctly — it is not a
promotion), but the aggregation cannot distinguish "checked and clean" from "did not run". This is
INFRA-048's defect surviving at the suite level. Out of scope here: it touches all 72 scans.

### D7 — `release-grade verification` silently skips 5 workspaces — **FILED as INFRA-063**

`harness:verify:release` runs `pnpm test` = `pnpm run -r --if-present test`. Five workspaces declare
no `test` script and are walked past silently: `packages/agent-cli-web`, `apps/blog`, `apps/docs`,
`apps/starter-nextjs`, `apps/www`. `check-test-coverage-scripts.mjs` explicitly exempts them
(`if (typeof testScript !== 'string') return false`), so nothing guards the absence. The manifest
calls this context "the FULL test/typecheck/lint sweep".

**Split from D5 rather than folded into it, and the reason is itself the finding.** The two read as
the same over-claim; they are not the same shape. D5's lived in the required-context NAME — the
string branch protection matches on — so it cost a ruleset change and an empty-queue window. D7's
lives in the declaration PROSE (`.github/required-status-checks.json`); the context name
`release-grade verification` never claims to be full. **So D7 needs no ruleset change and carries
none of D5's hazard.**

And it is not merely prose. `packages/agent-cli-web` declares a **`test:e2e`** script, which
`pnpm run -r --if-present test` does not match — a suite that exists, is maintained, and is never
run by the release gate. `harness:verify:release` already appends
`pnpm --filter @robota-sdk/agent-cli test:bin` by hand for exactly this reason: the identical case,
recognised once and never generalised. So D7 is a COVERAGE fix plus a prose correction — filed as
**INFRA-063**, not folded in as a rename.

### D8 — `check-patch-coverage --detect` fails OPEN — **FILED**

When the base ref cannot be resolved, `--detect` reports `affected=false`, so the advisory job
prints its skip echo and computes nothing. Advisory, so low stakes, but it is the same
"undeterminable renders as clean" shape.

### D9 — `ci.yml` declares no `permissions:` — **FILED, not changed**

No job restricts the `GITHUB_TOKEN`; every job inherits the repository default. ci.yml makes no API
calls, so this is latent over-permission rather than a broken check. A top-level
`permissions: {contents: read, actions: read}` is the fix, but it cannot be falsified locally and a
wrong guess reddens every PR — so it is filed rather than guessed.

### D10 — noted, not touched: `claude-code-review.yml` is deadlocked

Independently surfaced: `scan-review-workflow-parity` exempts only base-`main` PRs while INFRA-051's
`promotion ancestry` forbids a base-`main` PR from carrying new work, so the file cannot currently
be modified while keeping CI green. Owner-owned.

Three fresh datapoints for INFRA-053, from this item's own PR (#1474) — and the useful part is that
it took all three to read it correctly. Each figure below is quoted from the run's own summary, not
inferred:

| Run         | Result    | `num_turns` | `permission_denials_count` |
| ----------- | --------- | ----------- | -------------------------- |
| 30195049439 | `failure` | 26          | 8                          |
| 30195184745 | `success` | —           | —                          |
| 30195264352 | `failure` | 26          | 6                          |

Same PR, same prompt, three runs. This item first recorded run 1 as a straightforward recurrence
("it can stay broken without anyone being forced to notice"); run 2 falsified that framing, and run
3 falsified the "coin-flip" reading that replaced it. Both corrections are kept rather than
overwritten, because the third reading is sharper than either and could not have been reached from
one run:

- **It is not random.** Both failures overran by EXACTLY ONE TURN (26 against a cap of 25). The
  reviewer's workload is essentially fixed; it lands on the boundary every time, and which side it
  falls on is decided by a turn or two of noise.
- **The denials are the whole margin, and they are not the same size each run** (8, then 6). At
  ~6-8 of 26 turns, roughly a quarter of the budget is spent being told no. Removing them takes the
  run to ~18-20 turns — comfortably under the existing cap, with room to spare.
- **So the fix is `allowed_tools`, not a bigger cap**, and now with a number behind it: raising 25
  to 26 would flip these two runs green while leaving the reviewer one unlucky turn from red again.
  Declaring the reads the prompt already asks for (`AGENTS.md`, `.agents/rules/*`) is what buys
  actual headroom. That is INFRA-053's conclusion, and this is the measurement supporting it.
- **An intermittent gate is worse than a red one**, for the reason `review-gate`'s severity split
  already records: a check that fails on a coin-flip is one people learn to re-run rather than read.

`Claude review` is NOT a required context on `protect-develop`, so none of this blocks a merge —
which is why it can stay this way without forcing anyone to look at it.

## Guards added

Both proven RED against the LIVE defect (fix reverted in place, scan re-run) and GREEN after, and
registered in `pnpm harness:scan`.

- `required-check-needs` — for every required context's job and every job in its `needs:`, either
  the dependency is itself required on that branch or the dependent's `if:` is fail-safe (a
  job-status function AND `needs.<dep>.result`). Reverting D3 reports exactly the three contexts
  #1424 merged on. Complements `scan-main-required-checks`'s R6, which covers `main` only and only
  an `if:`-excluded dependency.
- `test-selection-tolerance` — a workflow step that NARROWS a test run must not route it through a
  script containing `--passWithNoTests`. Reverting D1 reports both windows-shell steps.
- `build-tooling-scope` (D4) — four rules, each red-proven against its own live defect and green
  after. **R1** every declared path still exists. **R2** the calculator, EXECUTED, resolves each
  declared path to the full workspace — reverting the fix in place reports all 8 as
  `resolves to 0 of 86 workspace scopes`, which is the pre-fix `scopes: []` exactly. **R3** every
  file root `package.json`'s build-defining scripts invoke is declared — adding
  `node scripts/migrate-session-history.mjs` to root `build` reports it, which is the recurrence
  this class produces. **R4** a docs-only change still resolves to ZERO scopes and still passes —
  declaring `README.md` as build tooling reports it, pinning the over-correction shut.

  R2 **executes** rather than reads. HARNESS-052's own guard derived its ledger by regex over
  source text and therefore measured spelling, not behaviour, in three separate places; a rule
  about a calculator's OUTPUT must run the calculator. The scan refuses to print a pass when it
  enumerated zero declared paths, zero workspace scopes or zero root build scripts.

**Where this guard's own ceiling is, stated rather than implied.** It cannot decide whether a path
IS build tooling. That judgement lives in the constant's membership rule, and a wrong judgement
there passes every rule above — the same ceiling this item's closing section already states for
every other structural guard. What the guard does catch is the part that actually rots: a declared
path going stale, the calculator silently ceasing to honour the list, a new build script joining
root `build` without joining it, and over-correction into docs.

**Inherited red, fixed in passing.** `guard-scope-fail-closed` rule 1 was already failing on
`origin/develop` — INFRA-058 registered `scan-required-check-needs` and
`scan-test-selection-tolerance` without classifying their finders (reproduced on a clean checkout
of `origin/develop`). Both were measured by EXECUTING them against a bare root — `fail-closed` and
`vacuous` respectively — and recorded in `PENDING_CLASSIFICATION`. This item's own scan measures
`fail-closed` and is pinned in `MANDATORY_TREE_GUARDS` with its governed tree named.

Both fail loudly on ZERO edges / ZERO invocations examined, so a broken parser cannot report a
clean pass over nothing. Each rule's two halves are unit-tested separately, because
`scan-main-required-checks` originally shipped green on three variants of its own defect.

## Where the mechanical ceiling is

This audit is not, and cannot be, complete. What no pattern can reach:

1. **A step whose logic is subtly wrong.** Every guard here is structural. A classifier with an
   off-by-one glob, a scan whose regex stopped matching, a test that asserts a weaker property than
   its name — all pass every structural check. D2 (a pure-function test standing in for a
   platform-specific one) was found by READING the test, not by any scan, and no scan would find
   the next one.
2. **Unchecked command substitutions generally.** D9's class (`$(...)` in a word-list swallowing a
   failure under `bash -e`) is a shellcheck problem (SC2312). Adding shellcheck to the scan suite
   means a network-fetched binary in the gate; the commitlint fix is therefore a one-off, and a
   sibling instance elsewhere would not be caught.
3. **Whether a scan's SUBJECT is still real.** `scan-ci-base-history` has an anti-rot check for its
   invocation list; most scans do not. A scan guarding a pattern the codebase no longer uses passes
   forever.
4. **The 8 jobs marked "reasoned only"** above. They are hypotheses. In particular `scans` and
   `tui-e2e` were run, not falsified — I did not construct a broken repository and confirm they
   redden.
5. **Anything requiring the live GitHub API.** The `skipped`-is-accepted premise is taken from this
   repo's own prior measurements (#1424, #1427, #1442), not re-measured here.
6. ~~The D3 fix's own failure branch is not validated by CI.~~ **Closed** — this was the one proof
   the item would otherwise have asserted rather than measured, so throwaway PR #1476 measured it
   (see D3). Recorded here because the reasoning is the reusable part: a fix's own failure branch is
   usually invisible to the PR that ships it, since that PR is by construction the healthy case.
   Ask, for every gate change, "which branch of this does my own CI run exercise?" — and use a
   throwaway PR for the other one, the way #1442 was used for the `edited` trigger.

## Test Plan

- `pnpm harness:scan` — **76/76** on a built tree (the local full run's only failure without one is
  `dist`, which needs built output and is skipped in CI by design).
- `pnpm harness:test` — **94 files / 1244 tests**.
- `pnpm harness:verify-like-ci` — **PASS, all 11 stages**.
- `pnpm build` and `pnpm typecheck` — both exit 0.
- Each new guard run RED against the reverted defect and GREEN against the fix. For D4 the revert
  was made IN PLACE (the workspace-wide branch short-circuited while the declared list stayed
  exported), so the proof is against the live pre-fix behaviour rather than a description of it.
- YAML parse of `ci.yml` (`yaml.parse`, 14 jobs enumerated) and `bash -n` on every touched `run:`.

## User Execution Test Scenarios

Not applicable — CI workflow and harness-guard changes deliver no runnable user-facing surface. The
enforcement evidence is the red/green proofs recorded above and the checks on this item's own PR.

## Closed 2026-07-27 — every finding now has a real disposition

The audit's ten findings were reconciled against the tree. Three of them said **FILED** with no
target, which is the same defect the audit itself catalogues: a claim that reads as closed and
closes nothing. Those are now real files.

|                | Disposition                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------- |
| D1, D3, D4, D5 | FIXED and merged                                                                            |
| D2             | filed as `INFRA-064` (was FILED with no target)                                             |
| D6             | filed as `HARNESS-056` (was FILED with no target)                                           |
| D7             | filed as `INFRA-063` — PR open                                                              |
| D8             | already FIXED — `check-patch-coverage --detect` carries `FAIL-CLOSED (HARNESS-052)` in code |
| D9             | FIXED — `scan-workflow-permissions` merged (#1481)                                          |
| D10            | resolved by `INFRA-062`, now closed                                                         |

Nothing from this audit is left holding an obligation of its own.
