---
title: 'INFRA-058: ci.yml job-by-job audit — three fail-open paths closed, four fidelity gaps filed'
status: in-progress
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

| #   | Job (context)                                         | Required | Purpose a reader would infer                                                                            | Fidelity                                                     | Falsified?                                                                                                                      | Verdict                               |
| --- | ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | `main-pr-source-guard` (`main PR source guard`)       | main     | A PR to `main` comes from develop/release/hotfix in THIS repo                                           | matches                                                      | **yes** — 6 cases run under `bash -e`: develop✓, feature✗, fork-named-develop✗, release/*✓, empty head_ref✗                     | PASS                                  |
| 2   | `promotion-ancestry` (`promotion ancestry`)           | main     | The promotion carries `main`'s ancestry (INFRA-051 A1/A3)                                               | matches                                                      | **yes** — ran the scan with `GITHUB_BASE_REF=main` + a non-promotion head; exit 1 on A1                                         | PASS                                  |
| 3   | `changes`                                             | **no**   | Classifies the PR code vs docs-only                                                                     | matches                                                      | **yes** — probe PR #1476 forced the job to fail and the consequence was measured (see D3)                                       | PASS, but see D3                      |
| 4   | `build`                                               | develop  | The monorepo builds                                                                                     | **checks the wrong thing**                                   | **yes** — see D4                                                                                                                | DEFECT (filed)                        |
| 5   | `quality`                                             | develop  | The affected scopes' build/test/lint/typecheck pass                                                     | **checks the wrong thing** on one PR shape                   | **yes** — see D4                                                                                                                | DEFECT (filed)                        |
| 6   | `scans`                                               | develop  | The harness suite + full dist-independent scan suite pass                                               | matches                                                      | **yes** — run in verification, 70 scans + 1153 harness tests                                                                    | PASS, but see D6                      |
| 7   | `security-audit` (`security audit`)                   | develop  | _Reads as:_ the PR was audited for security. _Is:_ an OSV dependency scan, only when a manifest changed | **over-claims in the name**                                  | **yes** — step extracted; unresolvable base ref correctly forces `changed=true`; regex verified on nested/lock/code-only inputs | ENFORCEMENT PASS, fidelity filed (D5) |
| 8   | `release-grade-verify` (`release-grade verification`) | main     | The FULL build/scan/test/typecheck/lint sweep                                                           | **over-claims** — `pnpm test` is `-r --if-present`           | partly — measured the 5 silently-skipped workspaces                                                                             | ENFORCEMENT PASS, fidelity filed (D7) |
| 9   | `commitlint`                                          | develop  | Every commit this PR authored is conventional                                                           | matches                                                      | **yes** — exited **0** on an unresolvable range                                                                                 | **DEFECT — FIXED**                    |
| 10  | `examples-typecheck`                                  | develop  | `examples/` typecheck against locally-built packages                                                    | matches                                                      | **graph** measured (#1476: dispatched on a failed `changes`); internal failure path reasoned                                    | PASS after D3 fix                     |
| 11  | `windows-shell`                                       | develop  | Cross-platform shell execution verified on real Windows                                                 | **step 1 over-reaches; both steps could pass on zero tests** | **yes** — a rename made it print `No test files found, exiting with code 0`                                                     | **DEFECT — FIXED**, plus D2 filed     |
| 12  | `tui-e2e`                                             | develop  | TUI PTY e2e against the built binary                                                                    | matches                                                      | **graph** measured (#1476: dispatched on a failed `changes`); internal failure path reasoned                                    | PASS after D3 fix                     |
| 13  | `regression-red-proof (advisory)`                     | no       | Advisory — name says so                                                                                 | matches (honest name)                                        | **graph** measured (#1476); internal path reasoned                                                                              | PASS                                  |
| 14  | `patch-coverage (advisory)`                           | no       | Advisory — name says so                                                                                 | matches                                                      | **graph** measured (#1476); internal path reasoned                                                                              | PASS, but see D8                      |

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

### D4 — `build` and `quality` both green having done nothing, on a build-tooling PR — **FILED**

A one-line change to `scripts/build-types-ordered.mjs` — the second half of root `pnpm build` —
resolves to `scopes: []`:

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

So `build` never runs `pnpm build`; `quality` verifies zero scopes, skips the binary e2e (gated on
`package_dist_required`) and runs `build-contracts` against no restored dist. Two REQUIRED checks,
both vacuous, on a PR that changes the build tooling itself.

Real build coverage does exist — `tui-e2e` and `examples-typecheck` both run `pnpm build:deps`, and
`changes` classifies this file as CODE — so a broken build IS caught. It is caught by jobs named
`tui-e2e` and `examples-typecheck`. That is the fidelity defect: `build`'s guarantee is delivered
elsewhere, and its own green means only "no scope asked for dist".

Not fixed here: the candidate fixes (require build whenever `changes.code == 'true'`; treat
build-relevant unmapped files as requiring dist) each change which PRs run a multi-minute build,
i.e. what gates a merge and what CI costs. Owner call.

### D5 — `security audit` claims more than it checks — **FILED**

The context name reads as "this PR was audited for security". It is an OSV **dependency** scan over
`pnpm-lock.yaml`, gated on a manifest/lockfile diff. A PR adding a command injection, a leaked
credential or a permissive CORS policy gets a green `security audit`. The narrow gating is itself
sound and complemented by `security-scheduled.yml` (INFRA-044 part 2) — the defect is the NAME.
Correcting it renames a required context: a ruleset change.

### D6 — `run-all-scans` renders SKIPPED as ✓ — **FILED**

A scan that prints SKIPPED and exits 0 is counted as a pass in the `N of M scans passed` line.
`scan-promotion-ancestry.mjs` does exactly this on every develop PR (correctly — it is not a
promotion), but the aggregation cannot distinguish "checked and clean" from "did not run". This is
INFRA-048's defect surviving at the suite level. Out of scope here: it touches all 72 scans.

### D7 — `release-grade verification` silently skips 5 workspaces — **FILED**

`harness:verify:release` runs `pnpm test` = `pnpm run -r --if-present test`. Five workspaces declare
no `test` script and are walked past silently: `packages/agent-cli-web`, `apps/blog`, `apps/docs`,
`apps/starter-nextjs`, `apps/www`. `check-test-coverage-scripts.mjs` explicitly exempts them
(`if (typeof testScript !== 'string') return false`), so nothing guards the absence. The manifest
calls this context "the FULL test/typecheck/lint sweep".

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

A fresh datapoint for INFRA-053, from this item's own PR (#1474) — and the interesting part is that
it took two runs of the SAME PR to read it correctly.

Run 30195049439 failed, with the cause in the run's own summary rather than inferred:

```
"subtype": "error_max_turns",  "num_turns": 26,  "permission_denials_count": 8
##[error]Execution failed: Reached maximum number of turns (25)
```

Run 30195184745 — same PR, same prompt, one docs-only commit later — completed `success`.

So `Claude review` is INTERMITTENT, not persistently broken. This item first recorded it as a
straightforward recurrence ("it can stay broken without anyone being forced to notice"); the very
next run falsified that framing, and the correction is kept rather than overwritten because the
corrected reading is the more useful one:

- The 25-turn cap is MARGINAL, not merely too low. The reviewer sometimes fits and sometimes does
  not, so the same PR can go either way.
- The 8 permission denials are what make the margin thin. That confirms INFRA-053's conclusion —
  fix the denials (declare `allowed_tools` for the reads the prompt asks for), do not just raise
  the cap, which would only move the coin-flip.
- An intermittent gate is worse than a red one for the reason `review-gate`'s severity split
  already records: a check that fails at random is a check people learn to re-run rather than read.

`Claude review` is NOT a required context on `protect-develop`, so none of this blocks a merge —
which is why the flakiness can persist without forcing anyone to look at it.

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

- `pnpm harness:scan` — 70/70 with `--skip dist --skip build-contracts` (the CI form); the local
  full run's only failure is `dist`, which needs a built tree and is skipped in CI by design.
- `pnpm harness:test` — 90 files / 1153 tests.
- `pnpm harness:verify-like-ci`.
- Each new guard run RED against the reverted defect and GREEN against the fix.
- YAML parse of `ci.yml` (`yaml.parse`, 14 jobs enumerated) and `bash -n` on every touched `run:`.

## User Execution Test Scenarios

Not applicable — CI workflow and harness-guard changes deliver no runnable user-facing surface. The
enforcement evidence is the red/green proofs recorded above and the checks on this item's own PR.
