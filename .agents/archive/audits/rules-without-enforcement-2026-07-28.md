---
title: AUDIT — rules without enforcement, and enforcement that cannot be reached
status: audit
type: AUDIT
tags: [harness, enforcement, audit]
date: 2026-07-28
---

# AUDIT — rules without enforcement, and enforcement that cannot be reached

Read-only audit. **No enforcement was implemented and no code was changed.** The proposed remediation
items at the end are described, not filed — they carry no IDs on purpose.

## Why this audit exists

Two confirmed failures share one shape: **written ≠ enforced, and registered ≠ reachable.**

- `git-branch.md` requires feature branches to be cut from `origin/develop`. The enforcing hook exists,
  is registered in `.claude/settings.json`, and never fires on a real command.
- `verify-like-ci.mjs` names, in its own header, the command that reproduces the required gate. Nothing
  runs it before a promotion.

The audit asks of every obligation in `.agents/rules/**`: is there a mechanism, can it be reached, and
has it been proven to fail on a violation.

## Method

- Obligations enumerated from all 19 rule documents plus the two pointer stubs — **292 normative rows**
  (MUST / MUST NOT / NEVER / ALWAYS / prohibited / mandatory / zero exceptions). Full inventory in Part 4.
- Mechanism inventory: `.claude/settings.json` hook registration, `.claude/hooks/*`, `.husky/*`,
  `scripts/harness/run-all-scans.mjs` (81 registered scans), `.github/workflows/*`,
  `.github/required-status-checks.json`.
- **Execution where execution is possible.** U1-U4 were reproduced by feeding each hook a synthetic
  PreToolUse payload and observing whether it blocked; probe transcripts are quoted inline. U5-U7 are
  wiring facts — a command nothing invokes, an env var nothing sets — established by exhaustive grep, and
  labelled as such. Anything neither executed nor exhaustively grepped is called a hypothesis.

## Verdict vocabulary

| Verdict       | Meaning                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `NONE`        | No mechanism of any kind. The rule is prose only.                                                    |
| `NAMED`       | The rule text names a mechanism; presence confirmed, firing not executed in this audit (hypothesis). |
| `FIRES`       | Executed against a violation in this audit and observed to block.                                    |
| `UNREACHABLE` | The mechanism exists and is registered, and was proven not to fire in the shape real usage produces. |
| `WEAK-SCOPE`  | Reachable, but its scope is self-declared or mis-targeted, so violations pass green.                 |

---

# Part 1 — Enforcement that exists but cannot be reached

This is the highest-value class and it is not empty. Seven findings, ordered by blast radius.

## U1 — `branch-guard.sh`: every git-action guard is `^`-anchored and dies on any command prefix

**Rules affected:** Branch Policy (`git-branch.md:144-160`), One-Branch-At-A-Time (`:220-251`),
Feature Branch Workflow (`:332-341`), branch-name convention.
**Mechanism:** `.claude/hooks/branch-guard.sh`, registered as a `PreToolUse`/`Bash` hook.

`branch-guard.sh:58` builds its action detector as:

```bash
GITPFX='^\s*(\S+=\S+\s+)*git\s+((-C|-c)\s+\S+\s+)*'
```

The `^` anchor requires `git` to be the **first token of the whole command string**. Every guard that
depends on `IS_COMMIT` / `IS_PUSH` / `IS_MERGE` / `IS_BRANCH_CREATE` therefore evaluates only for a bare,
single-statement `git …` invocation.

**Proven (probe feeding the hook synthetic PreToolUse JSON; the commands themselves were never run):**

| Probe | Command fed to the hook                                       | Result                                       |
| ----- | ------------------------------------------------------------- | -------------------------------------------- |
| T1    | `git checkout -b bad_name`                                    | `exit=2` — blocked (unmerged-branches guard) |
| T2    | `cd /home/ubuntu/dev/robota && git checkout -b bad_name`      | **`exit=0` — silent pass**                   |
| T8    | `git fetch origin && git checkout -b bad_name origin/develop` | **`exit=0` — silent pass**                   |
| T9    | `git checkout -b bad_name origin/develop && git fetch origin` | `exit=2` — blocked                           |
| T10   | `git status --short && git commit -m x`                       | **`exit=0` — silent pass**                   |

T8 is the finding. **`git fetch origin && git checkout -b <type>/<slug> origin/develop` is the exact
command `git-branch.md:155` prescribes**, and it defeats the guard that enforces the same section. T9 is
the control: move the create to position 0 and the identical branch name blocks.

The bug is selective, which is why it survived. The two `gh`-based delete guards use **non-anchored**
patterns and fire regardless of prefix:

| Probe | Command                                                                      | Result             |
| ----- | ---------------------------------------------------------------------------- | ------------------ |
| T6    | `cd /home/ubuntu/dev/robota && git push origin --delete some-feature-branch` | `exit=2` — blocked |
| T7    | `cd /home/ubuntu/dev/robota && gh pr merge 1 --squash --delete-branch`       | `exit=2` — blocked |

So the hook looks alive in exactly the operations that were debugged most recently, while the branch-policy
half is dark.

**Backstops.** `.husky/pre-commit` independently blocks protected-branch commits and says so in its own
header, so U1 does not leave protected-branch commits open. GitHub's `protect-main` ruleset blocks
push/merge to `main` server-side. **Branch creation has no backstop at all** — git has no pre-checkout
hook — and branch creation is rule area #2 by measured rework (Part 2).

**The repo already knows the correct pattern.** `worktree-cwd-guard.sh` uses
`GITPFX='(^|[[:space:];&|(])…'`. Two of three Bash hooks were never updated to it.

## U2 — `pre-push-check.sh`: same anchor, and it is the only mechanism for "never branch from `main`"

**Rule:** `git-branch.md:153-160` — feature branches created from freshly-fetched `origin/develop`, never
from `main`, never from another local feature branch. The rule names `.claude/hooks/pre-push-check.sh` as
the enforcement.
**Mechanism:** `.claude/hooks/pre-push-check.sh:23`:

```bash
echo "$COMMAND" | grep -qE '^\s*(\S+=\S+\s+)*git\s+((-C|-c)\s+\S+\s+)*push(\s|$)' || exit 0
```

**Proven:**

| Probe | Command                                                 | Result                                                      |
| ----- | ------------------------------------------------------- | ----------------------------------------------------------- |
| T3    | `git push -u origin HEAD`                               | `[pre-push-check] Running fast pre-push gates…` → gates ran |
| T4    | `cd /home/ubuntu/dev/robota && git push -u origin HEAD` | `exit=0` with **no output** — returned before any gate      |

Two compounding gaps make this rule the weakest-guarded high-cost rule in the repo:

1. **There is no create-time check of the branch's base at all.** `grep -c "origin/develop"
.claude/hooks/branch-guard.sh` → `0`. The create guard checks unmerged branches and the name pattern;
   it never inspects the start point. So "cut from `origin/develop`" is not enforced when the branch is
   created.
2. **The only enforcement is post-hoc and partial** — pre-push-check's "zero merge commits over
   `origin/develop`" heuristic, which catches a branch cut from `main` only once `main` carries merge
   commits `develop` lacks, and which T4 shows is bypassed by any prefixed push.

## U3 — `worktree-cwd-guard.sh`: gated on an env var nothing sets

**Rule:** the worktree guardrails in `git-branch.md:13-31` (destructive git commands must not hit the main
clone from a worktree session).
**Mechanism:** `.claude/hooks/worktree-cwd-guard.sh`, registered as a `PreToolUse`/`Bash` hook, backed by
`scripts/harness/__tests__/worktree-cwd-guard.test.mjs`.

The guard fails open unless a marker is present (`worktree-cwd-guard.sh:51`):

```bash
if [[ -z "${ROBOTA_AGENT_WORKTREE:-}" ]]; then
  exit 0
fi
```

Its own header admits the wiring is aspirational: the launcher _"SHOULD export
`ROBOTA_AGENT_WORKTREE=<assigned worktree path>`"_.

**Proven, in the exact session that wrote this audit** — an `Agent`-tool worktree subagent running in
`/home/ubuntu/dev/robota/.claude/worktrees/agent-a6b30583755ab60e7`:

```
$ env | grep -i -E "ROBOTA|CLAUDE_PROJECT"
PWD=/home/ubuntu/dev/robota/.claude/worktrees/agent-a6b30583755ab60e7
OLDPWD=/home/ubuntu/dev/robota/.claude/worktrees/agent-a6b30583755ab60e7
```

`ROBOTA_AGENT_WORKTREE` is unset. Repo-wide grep finds it in exactly three places: the hook itself, the
hook's own test file, and the completed backlog item that designed it. **No launcher, no settings block,
no wrapper sets it.** `.claude/settings.json` has no `env` section.

The guard's 10 tests pass — I ran them:

```
✓ scripts/harness/__tests__/worktree-cwd-guard.test.mjs (10 tests) 280ms
```

Green tests over a guard that cannot fire. The test supplies the marker itself
(`env: { ROBOTA_AGENT_WORKTREE: worktreeRepo }`), so it proves the logic and can never observe the wiring
gap. This is the purest instance of the audit's thesis in the repo.

## U4 — `check-forbidden-patterns.sh`: scope filter excludes every worktree session

**Rule:** No Fallback Policy (`operational.md:9-14`), common-mistakes #9. The hook is the pre-write floor
in front of `scan-no-fallback.mjs`.
**Mechanism:** `.claude/hooks/check-forbidden-patterns.sh`, registered as a `PreToolUse`/`Edit|Write` hook.

Lines 21 and 32-38:

```bash
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
case "$FILE_PATH" in
  "$PROJECT_DIR"/packages/*/src/*.ts|…) ;;
  *) exit 0 ;;
esac
```

In a worktree session `CLAUDE_PROJECT_DIR` resolves to the **main clone**, while the file being written
lives under `.claude/worktrees/agent-*/packages/…`. The `case` prefix then fails and the hook exits 0.

That `CLAUDE_PROJECT_DIR` points at the main clone in a worktree session is not my inference — it is
documented in this repo, in `branch-guard.sh:37-39`: _"a worktree agent's commit/push was judged against
the MAIN clone's branch (`CLAUDE_PROJECT_DIR`), producing false blocks."_ `branch-guard.sh` and
`pre-push-check.sh` were both patched to prefer the hook-input `cwd`. `check-forbidden-patterns.sh` was not.

**Proven** — identical violating content (a `catch` block returning `null`), identical file path, only
`CLAUDE_PROJECT_DIR` differs:

```
--- CONTROL (project dir = worktree)
❌ [check-forbidden-patterns] Blocked — forbidden pattern(s) in packages/agent-core/src/probe.ts:
  line 4:   } catch (e) {
    exit=2

--- WORKTREE SESSION (project dir = main clone)
    exit=0
```

**Why the test did not catch it:** `scripts/harness/self-check.mjs:83-93` runs the hook with
`projectDir` = a temp dir and `file_path` = `<projectDir>/packages/example/src/provider.ts`. The file is
always _under_ `projectDir`, so the fixture cannot reproduce the mismatch. The check is verified in a
geometry that never occurs.

## U5 — `verify-like-ci` is named as THE gate and is invoked by nothing

**Rules:** `git-branch.md:50` ("**Before pushing or merging, run `pnpm harness:verify-like-ci`**"),
`verification.md:100-104`, `verification.md:59`.
**Mechanism:** `scripts/harness/verify-like-ci.mjs`, 11 stages pinned to CI by `ci-mirror-map.mjs`.

The script is real and well built. Its _invocation_ is enforced by nothing:

- `.husky/pre-push` runs `pnpm harness:pre-push` only → `scripts/harness/pre-push.mjs`, which runs
  stale-worktree pruning (warn-only), `assertCleanWorkingTree()`, `assertLockfileConsistency()`,
  `pnpm harness:plan`, a scoped `pnpm harness:verify`, and a `cli:dev --version` smoke. It never calls
  `verify-like-ci`, never calls `run-all-scans`, and can skip wholesale via `decidePrePushVerification`.
- No file under `.github/workflows/` invokes it.
- `.husky/pre-commit` runs the two branch/lessons guards and `lint-staged` — no harness checks.

So the repo's stated CI mirror is advice. What actually blocks a push is a clean tree, the lockfile, and a
scoped verify. The anti-drift protection that does exist is over the map's **contents**
(`ci-mirror-map.test.mjs` reddens `pnpm harness:test` when a required context goes unclaimed), never over
its **execution**. This is the brief's confirmed instance #2, and it is still structurally true after
INFRA-056 fixed _what the command runs_.

## U6 — the accidental-green floor and the patch-coverage floor are gated on env vars set nowhere

**Rules:** `tdd-and-planning.md:12` (TDD-PROVE-RED), `verification.md:47` (VER-RED-BEFORE-PUSH),
common-mistakes #82.
**Mechanism:** `check-regression-red-proof.mjs` (ci.yml:729) and `check-patch-coverage.mjs` (ci.yml:774).

Both exit 0 unless `REGRESSION_RED_PROOF_ENFORCE=1` / `PATCH_COVERAGE_ENFORCE=1`. Repo-wide grep shows
those variables set in **no workflow and no script** — only in the checkers' own defaults, their tests,
and prose. `.github/required-status-checks.json:66-70` lists both under `deliberately_not_required` with
the reason _"a required context must be able to fail, and these deliberately cannot."_

This is **deliberate and honestly declared**, with `INFRA-046` tracking the flip. It is listed here
because the _rule_ reads as absolute while today nothing can fail on it: the only mechanism the
anti-accidental-green rule has is non-blocking by construction. The rule that produced the repo's most
recent recurring defect class is, right now, prose plus a print statement.

## U8 — the CI-mirror gate fails on a markdown-only branch in a fresh worktree, and it did so to this audit

Found by dogfooding: `git-branch.md:50` says to run `pnpm harness:verify-like-ci` before pushing, so I
ran it on this branch — one new markdown file, zero code.

```
verify-like-ci summary:
✓ format-check   ✓ commitlint   ✓ harness-self-test   ✓ scan-suite-dist-free
✗ typecheck
✓ build — 75 package(s) have no dist/ — the dist-dependent scans would silently no-op
✓ scan-suite   ✓ affected-verify
FAIL — 1 of 11 stage(s) failed: typecheck
```

Immediately afterwards, the same command in the same tree:

```
$ pnpm -w typecheck
typecheck exit=0
```

I then re-ran the whole gate on the **identical branch and identical diff**, changing nothing but the
presence of the `dist/` the first run's build stage had produced:

```
✓ typecheck
- build — no scope needs build output and dist is present — ci.yml → build skips too
PASS — all 11 stage(s) passed; mirrors the required checks of `develop`.
```

**Same commit, same one-file diff: FAIL on run 1, PASS on run 2.** The gate's verdict depends on whether
a build artifact happens to be lying around.

The stage list in `ci-mirror-map.mjs` declares `typecheck` (line 93) **before** `build` (line 98). An
`Agent`-tool worktree starts with no `dist/` — the build stage says so itself, "75 package(s) have no
`dist/`" — so `pnpm -w typecheck` runs against missing declaration files and fails. Once the build stage
has run, the identical command passes.

This is HARNESS-053's shape (_"a stale `dist` made `pnpm typecheck` report three phantom failures on a
healthy `origin/develop` … has now cost a full investigation cycle"_) still live, in the ordering rather
than in the freshness scan. Two consequences:

- **A docs-only branch cannot get a green from the gate the rules mandate**, in the environment
  worktree-parallel agents run in. `git-branch.md:68` advertises this path as "~20s"; the observed run
  took minutes and ended red.
- **It is a standing incentive to skip the command** — which is finding U5's mechanism-of-inaction. A gate
  that is advisory _and_ red for reasons the author did not cause will be skipped, and was: the two failed
  promotions in the brief are what skipping looks like.

## U7 — `scan-promotion-ancestry`'s registry slot is decorative

`scan-promotion-ancestry.mjs:257-262` prints `SKIPPED` and returns 0 unless `GITHUB_BASE_REF === 'main'`.
It is registered in `run-all-scans.mjs`, but the `scans` CI job runs only when `base_ref != 'main'`, so
inside `pnpm harness:scan` it is a guaranteed no-op on every develop PR and every local run.

**Not a hole** — the promotion is genuinely gated by the dedicated `promotion-ancestry` required job. Listed
so nobody counts the registry slot as coverage. Same pattern, benign: `scan-action-references.mjs`'s
resolvability half runs only under `CI` with a non-`main` base, and `scan-dist-freshness` /
`check-build-output-contracts` are `--skip`ped in the develop `scans` job.

---

# Part 1b — Reachable, but scoped so violations pass green

## W1 — the `/code-review` gate has no runtime mechanism at all

`git-branch.md:354-388` — _"Every PR the agent opens must pass a `/code-review` before it is merged…
zero exceptions"_ — and `verification.md:24`.

The `review-gate` required check is **not** this gate. `check-review-gate.mjs` reads GitHub
**code-scanning** output and blocks on alerts the PR introduces at `error` / security-high. It has no
knowledge of whether a `/code-review` was run or whether findings were resolved.

`scan-review-findings.mjs` sounds like the missing floor but is not: its own header says it checks
_"CONTRACT PRESENCE (that the pieces still say what the design requires)"_ — that
`.claude/agents/pr-review-reviewer.md` still declares `ACTIONABLE FINDINGS: <n>` and that the
orchestration skill still contains the gate sentences. **A PR can merge with no review having happened and
every mechanical check stays green.** The same is true of Merge Landing Verification
(`git-branch.md:270-285`) — the `merge-verifier` agent is named as "the mechanism", and nothing verifies it
was dispatched.

This is a class worth naming: **scans that verify the text of a mechanism exists, not that the mechanism
ran.**

## W2 — `scan-test-plan` does not look at the directory the rule mandates

`tdd-and-planning.md:26-31` requires every plan to carry a Test Strategy and names
`pnpm harness:scan:test-plans` as the mechanical enforcement. `tdd-and-planning.md:35` requires every
implementation plan to live at `docs/plans/YYYY-MM-DD-<topic>-design.md`.

`scan-test-plan.mjs:20`:

```js
const SCAN_DIRS = ['docs/superpowers/plans', 'docs/superpowers/specs', '.agents/tasks'];
```

`docs/plans/` — the mandated location — is **not scanned**. `.agents/tasks/` contains only `README.md` and
`completed/` (excluded), so that root contributes nothing.

**Proven:**

```
$ node scripts/harness/scan-test-plan.mjs
harness test-plan scan passed.   exit=0
```

…while **13 of the 24 documents in `docs/plans/` carry no test-plan heading at all.** The scan is green
because it is pointed away from the rule's own mandated location.

## W3 — `check-functional-coverage` and `scan-capability-reachability` validate only what someone declared

- `check-functional-coverage.mjs` reads `functional-coverage-manifest.json`. It verifies the listed tests
  exist and use the harness. A new framework capability shipped **without** a manifest row is invisible to
  it, so `testing-layering.md:22` ("new capabilities MUST be registered") is not the thing enforced.
- `scan-capability-reachability.mjs` is opt-in on `capability: true` frontmatter and says so honestly:
  _"an author who never sets `capability: true` is not caught here."_ Measured coverage today: **13 of 237
  specs in `.agents/spec-docs/done/` (5.5%)** opt in.

Both are honest about their scope. Neither is a floor under the obligation as written.

## W4 — the 72-character commit subject limit is not the limit that is enforced

`git-branch.md:80` — _"Conventional commit format: `<type>(<scope>): <message>` (max 72 chars)"_.
`commitlint.config.js` extends `config-conventional`, whose `header-max-length` default is 100.

**Proven** — a 97-character subject:

```
$ npx --no-install commitlint --edit <97-char subject>
exit=0
```

Between 73 and 100 characters the stated rule is unenforced. **This audit's own commit is live evidence:**
its subject is 75 characters, three over the stated limit, and `.husky/commit-msg` accepted it without a
word.

## W5 — `@ts-ignore` is "PROHIBITED" and configured as a warning

`code-quality.md:11` — _"`// @ts-ignore` and `// @ts-nocheck` are PROHIBITED"_.

`.eslintrc.json:53` sets `"@typescript-eslint/ban-ts-comment": "warn"`, and **no `--max-warnings` flag
exists anywhere** in `package.json`, `.lintstagedrc*`, `ci.yml`, or the harness scripts:

```
$ grep -n '"lint"' package.json
24:  "lint": "eslint packages apps --ext .ts,.tsx --cache"
$ grep -rn "max-warnings" .lintstagedrc* package.json .github/workflows/ci.yml scripts/harness/verify-change.mjs
(no output)
```

ESLint exits 0 on warnings, so a `@ts-ignore` in shipped source passes `pnpm lint`, `quality`, and every
required check. Contrast `no-explicit-any` and `no-console`, which are `"error"` on the same config.

**Labelled a hypothesis on firing, not on configuration.** I could not execute-prove it: typed linting
rejects a `--stdin` fixture, writing a fixture into `packages/**` was outside this audit's permissions,
and — the reason nobody has hit it — **the repo currently contains zero `@ts-ignore` occurrences**. The
rule is being observed voluntarily, which is exactly the state in which a non-blocking mechanism looks
healthy.

## W6 — `spec-first-gate.sh` cannot block

`spec-workflow.md:120` names `.claude/hooks/spec-first-gate.sh` as the enforcement of "no `.ts` writes
before a spec exists". The hook contains **zero blocking exits** (`grep -c "exit 2"` → `0`); it is a
`UserPromptSubmit` advisory that prints a reminder when strong new-feature intent is detected. The real
gate is `scan-spec-research.mjs` + GATE-WRITE, which the hook's own text points to. The rule's phrasing
("`Write`/`Edit` to `.ts` … are NOT ALLOWED") reads as a hard block that no mechanism provides.

---

# Part 2 — Ranked by measured rework

Ranked by rework actually incurred (git history 2026-07-12 → 2026-07-27: 475 commits, 353 non-merge, of
which **133 (38%) carry a process-rework scope**), not by how important the rule sounds.

### 1. Check/gate VALIDITY — "a required check reports success over work it never did"

The largest measured cost by a wide margin. **19 backlog items filed and closed in ~48 hours**;
**47 of the 96 commits on 2026-07-26/27 (49%) are guard/CI self-repair**, including 13 consecutive
one-line fixes to guards on a single day.

- INFRA-055: **all five of `protect-main`'s required checks were 3-6 second echoes** on PR #1427; the only
  job that verifies a promotion was not required; CodeQL failed and the PR merged.
- INFRA-050: PR #1424 merged with `tui-e2e`, `windows-shell`, `examples-typecheck` all reporting
  `skipping` — three required checks that never ran.
- HARNESS-052: **~30 of 76 scans measured vacuous.**
- Compounding: a newly written guard shipped containing the very defect it audited, three times in one
  session.

Audit findings in this class: **U3, U4, U6, U7, W1, W2, W3**. Not represented in `common-mistakes.md` at all.

### 2. Branch / base cutting and promotion ancestry

Five distinct incidents over four months; `branch-guard.sh` has **14 repair commits all-time**, 8 since
2026-07-17.

- 2026-07-17: branch cut from a squash-merged local base → merge failed DIRTY → **PR #1176 orphaned**,
  cherry-pick recovery.
- 2026-07-18: feature branch based on `main` (#1216) → main/develop split, still costing today as part of
  INFRA-051's frozen adoption baseline.
- 2026-07-26: **branch-guard allowed deleting a branch whose PR #1483 was open — GitHub closed it**, "the
  exact outcome this guard exists to prevent."
- 2026-07-26: base-retarget bypass — PR #1442 measured `CLEAN` with all three `main`-only contexts
  `SKIPPED`; a feature branch one click from landing on `main`.

Audit findings: **U1, U2**. This is the area where the brief's confirmed instance #1 lives, and the audit
shows it is _worse_ than reported: the create-time base check does not exist, and the push-time one is
anchor-bypassable.

### 3. Local verification ≠ CI

Five items in three days, all repairing one entry point: HARNESS-045 (#1384) → HARNESS-047 (#1394) →
INFRA-056 (#1457) → HARNESS-053 (#1486/#1491) → INFRA-063 (#1498). Named failing PRs: **#1346, #1357,
#1369, #1381**. INFRA-056's measurement: the command every agent is told is the CI mirror **ran neither
`pnpm build` nor any package test suite**, passing in 23s on a tree carrying a real regression.

Audit finding: **U5** — INFRA-056 fixed _what the command runs_; nothing yet makes anyone run it.

### 4. Accidental-green regression tests

Recurred twice in one session (ARCH-004 RUNTIME-14, CORE-026 RUNTIME-12), both caught only because a
reviewer re-ran them against `origin/develop`. Mechanized as `check-regression-red-proof.mjs` and
**still non-blocking**. Audit finding: **U6**.

### 5. Status / evidence reconciliation drift

Recurring bulk cleanups rather than single incidents: #1314 (9 items), #1257 (8), #1354 (17), #1462 (11).
The only quantitative lessons signal available — `same-file-edited-3-times`, **159 events in 7 days** —
has all five example paths in harness docs. Mechanized by `check-backlog-placement.mjs` /
`check-task-archival.mjs`, which do hold.

### 6. Everything else

Dependency/security remediation absorbed as unplanned rework (SEC-002/003/005/006), ID collisions under
parallel authoring (**four in one day**), architecture placement (high severity, one incident each, no
repeat). These are real but not enforcement-reachability problems.

### Standing violation with zero mechanism, measurable right now

`git-branch.md:287-303`, "Delete Merged Branches (mandatory)". No hook, no scan, no CI job references
branch cleanup. Measured in this checkout: **132 local branches, 48 of them already merged into
`origin/develop` and still standing.** The rule's own text records 105 accumulated by 2026-07-25.

---

# Part 3 — What is healthy (so the gaps stay in proportion)

Stated as negative findings, because it locates the defect precisely in the hook layer.

- **No orphan scans.** All 81 registry entries resolve; the only four `scan-*`/`check-*` files outside
  `run-all-scans.mjs` are each reached by a workflow, a package script, or an import
  (`check-patch-coverage`, `check-regression-red-proof`, `check-review-gate`, `check-plan`). Verified by
  full-repo grep. `scan-ci-base-history.mjs:63-70` even guards that out-of-registry status.
- **No structurally unreachable CI job.** `ci.yml` has no `paths` filter and no `continue-on-error`; every
  conditional job is satisfied by a routine PR.
- **The scan layer is proven, not asserted.** `pnpm harness:test` — I ran it: **99 files, 1436 tests,
  all passing in 6.23s.** Many of these are RED-fixture tests that prove their scan fires.
- **`required-status-checks.json` is itself an audit artifact**, declaring per-branch what is required and
  why each exclusion is safe.
- **Advisory is a per-line channel, not a per-scan mode.** `run-all-scans.mjs` fails on any non-zero exit;
  only `scan-dist-freshness`'s freshness half emits advisories.

**The asymmetry is the finding.** `scripts/harness/` has 100 test files and a registry. `.claude/hooks/`
has 11 scripts, **no scan reads `.claude/settings.json` at all**, nothing checks that a hook is registered
or that a registered hook fires, and only 5 of the 11 hooks are exercised by any test —
`branch-guard.sh` and `pre-push-check.sh`, the two carrying U1 and U2, **have no test whatsoever**. Every
finding in Part 1 lives in the layer with no floor under it, which is precisely what
`enforcement-architecture.md:30` forbids: _"Every guardian MUST be backed by a mechanical floor."_ The
hook layer is the guardian that has none.

---

# Part 4 — Full obligation inventory

292 normative obligations across 19 rule documents plus 3 pointer stubs. The **Mechanism** column records
what the rule text itself names — it is an extraction, not a claim that the mechanism works. The
**Verdict** column is mine, and only `FIRES` / `UNREACHABLE` / `WEAK-SCOPE` were executed in this audit;
`NAMED` means present-but-not-executed and should be read as a hypothesis.

**Totals: `NONE` 232 · `NAMED` 44 · `FIRES` 2 · `UNREACHABLE` 8 · `WEAK-SCOPE` 6.**
Roughly **four out of five obligations in `.agents/rules/**` have no mechanism named at all.**

## 4.1 `git-branch.md` (the rules the audit was commissioned over)

| RULE-ID                        | line    | Obligation                                                                                                                | Mechanism                                          | Verdict                                                    |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| GB-WORKTREE-ONE-TREE           | 15      | One working tree per session; never edit the main clone from a worktree session                                           | `pre-push.mjs` prune-and-warn (non-blocking)       | NONE                                                       |
| GB-WORKTREE-ISOLATED           | 18      | Worktrees only in the managed path or outside the repo                                                                    | —                                                  | NONE                                                       |
| GB-WORKTREE-BRANCH             | 20      | Each worktree gets its own branch cut from freshly-fetched `origin/develop`                                               | —                                                  | NONE                                                       |
| GB-WORKTREE-CLEANUP            | 22      | `git worktree remove` + `prune` when done                                                                                 | `pre-push.mjs` (warns only)                        | NONE                                                       |
| GB-WORKTREE-DESTRUCTIVE        | 13-31   | Destructive git commands must not hit the main clone from a worktree session                                              | `.claude/hooks/worktree-cwd-guard.sh`              | **UNREACHABLE (U3)**                                       |
| GB-CLEAN-COMMIT                | 35      | Every modified/new file staged, ignored, or explicitly discarded before a commit                                          | `git status --short`                               | NONE                                                       |
| GB-CLEAN-PUSH                  | 46      | Working tree clean before push                                                                                            | `pre-push.mjs` `assertCleanWorkingTree()`          | NAMED                                                      |
| GB-VERIFY-LIKE-CI              | 50      | Run `pnpm harness:verify-like-ci` before pushing or merging                                                               | `verify-like-ci.mjs`                               | **UNREACHABLE (U5)**                                       |
| GB-NO-PARTIAL-GATE             | 66      | Never report a `--only` partial run as green                                                                              | prints `PARTIAL` banner                            | NAMED                                                      |
| GB-RELEASE-GATE                | 72      | A PR into `main` needs `pnpm harness:verify:release`                                                                      | `release-grade verification` required check        | NAMED                                                      |
| GB-APPROVAL                    | 79      | No `git commit` / `git push` without explicit user approval                                                               | —                                                  | NONE                                                       |
| GB-CONVENTIONAL                | 80      | `<type>(<scope>): <message>`, max 72 chars                                                                                | `.husky/commit-msg` → commitlint                   | **WEAK-SCOPE (W4)** — 97 chars passes                      |
| GB-COMMIT-TYPES                | 81      | Valid types only                                                                                                          | commitlint `config-conventional`                   | NAMED                                                      |
| GB-CADENCE                     | 85      | Commit at logical boundaries as work progresses; never batch or defer to context exhaustion                               | —                                                  | NONE                                                       |
| GB-NO-DELETE-BRANCH-FLAG       | 96      | Never pass `--delete-branch` to `gh pr merge`. Zero exceptions                                                            | `branch-guard.sh`                                  | **FIRES** (probe T7, prefix-tolerant)                      |
| GB-SAFE-DELETE-FORM            | 111     | Use `git branch -d`, never `-D`, for routine post-merge cleanup                                                           | —                                                  | NONE                                                       |
| GB-NO-DELETE-CONDITIONS        | 118-120 | Do not delete when the branch carries unmerged commits, is checked out in a worktree, or is an integration/release branch | —                                                  | NONE                                                       |
| GB-CONFIRM-BEFORE-DELETE       | 126     | Confirm merged AND no open PR before deleting a remote branch. Zero exceptions                                            | `branch-guard.sh` L2                               | **FIRES** (probes T5/T6)                                   |
| GB-MAIN-PROTECTED              | 144     | No direct commits/pushes/merges to `main`                                                                                 | `branch-guard.sh` + `.husky/pre-commit` + rulesets | **UNREACHABLE (U1)** in the hook; husky + ruleset backstop |
| GB-MAIN-PR-SOURCE              | 145     | A PR to `main` may only come from `develop` / `release/*` / `hotfix/*`                                                    | `main-pr-source-guard` CI job (required)           | NAMED                                                      |
| GB-DEVELOP-PROTECTED           | 149     | No direct commits to `develop`                                                                                            | `.husky/pre-commit` + `branch-guard.sh`            | **UNREACHABLE (U1)** in the hook; husky backstop           |
| GB-BRANCH-FROM-DEVELOP         | 153     | Feature branches created from freshly-fetched `origin/develop`; never from `main` or another feature branch               | `pre-push-check.sh`                                | **UNREACHABLE (U2)**; no create-time check exists          |
| GB-ZERO-MERGE-COMMITS          | 157     | A clean feature branch has zero merge commits over `origin/develop`                                                       | `pre-push-check.sh`                                | **UNREACHABLE (U2)**                                       |
| GB-PROMOTION-APPROVAL          | 161     | `develop`→`main` needs explicit user approval                                                                             | —                                                  | NONE                                                       |
| GB-PROMOTE-TOOL                | 162     | Build the promotion branch with `promote.mjs`, never by hand                                                              | `scripts/harness/promote.mjs`                      | NAMED                                                      |
| GB-MERGE-FORK-POINT            | 163     | Always merge back to the fork origin; verify the fork point                                                               | —                                                  | NONE                                                       |
| GB-MERGE-TARGET-APPROVAL       | 164     | A different merge target needs explicit approval                                                                          | —                                                  | NONE                                                       |
| GB-NO-ASSUME-MAIN              | 165     | Never assume `main` as default merge target                                                                               | —                                                  | NONE                                                       |
| GB-NO-SQUASH-SYNC              | 172     | Squashing a sync merge is prohibited in both directions                                                                   | `promotion ancestry` required check                | NAMED                                                      |
| GB-NO-UPDATE-BRANCH            | 201     | Never use GitHub's "Update branch" button on a promotion PR                                                               | `promotion ancestry` (fails closed)                | NAMED                                                      |
| GB-MERGE-METHOD                | 207     | Merge the promotion with `--merge`, never `--squash`                                                                      | `protect-main` `allowed_merge_methods`             | NAMED                                                      |
| GB-ONE-BRANCH                  | 226     | Before creating a branch, stop if any feature branch is unmerged; ask the user                                            | `branch-guard.sh` create-check                     | **UNREACHABLE (U1)**                                       |
| GB-PR-BATCH                    | 256     | Bundle a coherent work-unit into one PR; soft ceiling ~600 lines / ~15 files                                              | —                                                  | NONE                                                       |
| GB-MERGE-LANDING               | 272     | Independently verify a merge landed before treating work as complete, every hop                                           | `merge-verifier` agent                             | **WEAK-SCOPE (W1)** — presence-only                        |
| GB-GATE-GREEN                  | 282     | Never treat "pending" or "not-required-skipped" as pass                                                                   | —                                                  | NONE                                                       |
| GB-DELETE-MERGED               | 289     | Merged feature branches must not be left standing                                                                         | —                                                  | **NONE** — 48 standing violations measured                 |
| GB-VERIFY-BEFORE-REMOTE-DELETE | 297     | `git merge-base --is-ancestor` must succeed before remote deletion                                                        | `branch-guard.sh` L2 (open-PR form)                | NAMED                                                      |
| GB-NEVER-DELETE-INTEGRATION    | 301     | Never delete `develop` or `main`                                                                                          | `branch-guard.sh` protected-name check             | NAMED                                                      |
| GB-DISCARD-CHURN               | 309     | Discard transient churn with a scoped `git checkout --` before switching branches                                         | —                                                  | NONE                                                       |
| GB-NO-COMMIT-LESSONS           | 315     | Never commit `.agents/evals/lessons/*`; stage explicit paths                                                              | `.husky/pre-commit` (`ALLOW_LESSONS_COMMIT=1`)     | NAMED                                                      |
| GB-VERIFY-BASE                 | 319     | New branch base verified with `git merge-base --is-ancestor origin/develop HEAD`                                          | —                                                  | NONE                                                       |
| GB-STASH-HYGIENE               | 327     | Never bare `git stash` / blind `pop` for known churn                                                                      | —                                                  | NONE                                                       |
| GB-FEATURE-BRANCH              | 334     | Never commit directly to `main` or release branches                                                                       | `.husky/pre-commit`                                | NAMED                                                      |
| GB-BRANCH-NAMING               | 336     | `<type>/<topic>`                                                                                                          | `branch-guard.sh` name check                       | **UNREACHABLE (U1)**                                       |
| GB-RELEASE-INTEGRATION         | 346     | Propose merge vs PR for release-branch work; never substitute or merge to resolve ambiguity                               | —                                                  | NONE                                                       |
| GB-CODE-REVIEW-GATE            | 356     | Every PR must pass `/code-review` with all findings resolved before merge. Zero exceptions                                | `/code-review`, `scan-review-findings.mjs`         | **WEAK-SCOPE (W1)** — presence-only                        |
| GB-REVIEW-PRECONDITION         | 361     | The gate runs on green required checks, scoped to the PR diff                                                             | —                                                  | NONE                                                       |
| GB-FINDING-RESOLVED            | 366     | Each finding fixed / refuted in writing / deferred to a linked backlog item                                               | —                                                  | NONE                                                       |
| GB-NO-SILENT-DEFER             | 374     | No CONFIRMED/PLAUSIBLE finding left silently unaddressed                                                                  | `scan-review-findings.mjs` (contract text)         | **WEAK-SCOPE (W1)**                                        |
| GB-DEPLOY                      | 396-399 | Cloudflare deploy topology; release-branch changes not deployed until merged to `main`                                    | —                                                  | NONE                                                       |

## 4.2 `backlog-execution.md` — 69 obligations

Authority and stop conditions (`:20`-`:67`, 12 rows: BE-AUTH-CLASSIFY, BE-AUTH-4CRIT, BE-AUTH-DOCUMENT,
BE-STOP-PRODUCT, BE-STOP-MULTIARCH, BE-STOP-CONTRACT, BE-STOP-BIZLEGAL, BE-STOP-NOVEL, BE-STOP-POLICYFILE,
BE-STOP-USERDOC, BE-DISCLOSURE-NOT-APPROVAL, BE-NO-BARE-DECISION) — **all NONE.**

| RULE-ID                    | line | Obligation                                                                                 | Mechanism                                                            | Verdict                                     |
| -------------------------- | ---- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------- |
| BE-RECGATE-PRESENT         | 78   | Recommendation gate presented before each work unit                                        | —                                                                    | NONE                                        |
| BE-RECGATE-CONTENT         | 80   | Gate content: approach, fit, affected surfaces, test + user-execution plan, open decisions | —                                                                    | NONE                                        |
| BE-RECGATE-INDEPENDENT     | 91   | Judged by an independent reviewer; `REJECT` never overridden                               | `proposal-reviewer` agent                                            | NAMED                                       |
| BE-RECGATE-RECORD          | 102  | `REVIEW VERDICT` + date recorded                                                           | —                                                                    | NONE                                        |
| BE-ONE-BACKLOG             | 106  | Finish one backlog completely before starting the next. Zero exceptions                    | `pre-push.mjs` clean-tree                                            | NAMED (partial proxy)                       |
| BE-NO-OPEN-PR-START        | 115  | Do not start a new backlog while the current PR is open                                    | —                                                                    | NONE                                        |
| BE-NO-UNCOMMITTED          | 116  | No uncommitted files after declaring done                                                  | `pre-push.mjs` (exit 1)                                              | NAMED                                       |
| BE-NO-COMBINE              | 118  | Do not combine two backlogs in one PR                                                      | —                                                                    | NONE                                        |
| BE-PR-UNIT                 | 126  | One backlog = one PR; oversized items split into named units                               | —                                                                    | NONE                                        |
| BE-PR-COHERENCE            | 130  | One coherent unit = one multi-commit PR                                                    | `git-branch.md` DX-001                                               | NONE                                        |
| BE-SEQUENCE                | 136  | Related items serialized; branches one at a time                                           | One-Branch-At-A-Time                                                 | **UNREACHABLE (U1)**                        |
| BE-PR-DESC                 | 144  | PR description carries recommendation, verdict, tests, gate result, risks                  | —                                                                    | NONE                                        |
| BE-UES-SECTION             | 150  | `## User Execution Test Scenarios` present before implementation starts                    | —                                                                    | NONE                                        |
| BE-SCRATCH-HOME            | 154  | Disposable scripts live in `scratch/src/`                                                  | `temp-script-placement` scan                                         | NAMED                                       |
| BE-UES-NOT-ENGINEERING     | 161  | A scenario is never a unit/integration/harness/CI command                                  | —                                                                    | NONE                                        |
| BE-UES-PRODUCT-SURFACE     | 167  | A scenario must use a product surface                                                      | —                                                                    | NONE                                        |
| BE-UES-CLI-DEFAULT         | 170  | CLI/TUI is the default surface for CLI packages                                            | —                                                                    | NONE                                        |
| BE-UES-EXERCISE-CODE       | 173  | The scenario must exercise the implemented code path                                       | —                                                                    | NONE                                        |
| BE-UES-NO-INVENT           | 176  | Doc/rule/governance-only changes mark N/A rather than invent a scenario                    | —                                                                    | NONE                                        |
| BE-UES-EXECUTE-PROCEDURE   | 180  | A doc-procedure scenario executes the procedure, not the document                          | —                                                                    | NONE                                        |
| BE-UES-CREDS-DECLARED      | 192  | Live-credential prerequisites stated explicitly                                            | —                                                                    | NONE                                        |
| BE-UES-CREDS-SMELL         | 196  | Credential-only observables restructured toward a provider-free observable                 | —                                                                    | NONE                                        |
| BE-UES-FIELDS              | 200  | Six required scenario fields                                                               | —                                                                    | NONE                                        |
| BE-UES-ENV-BUILD           | 211  | Missing test environment must be built, proposed, or asked about                           | —                                                                    | NONE                                        |
| BE-CAP-NO-NA               | 215  | A library-seam capability may not mark the gate N/A                                        | `scan-capability-reachability.mjs`                                   | **WEAK-SCOPE (W3)** — opt-in, 5.5% coverage |
| BE-CAP-REACHABLE           | 221  | The capability must be reachable via a surface that enables the seam                       | —                                                                    | NONE                                        |
| BE-CAP-AGENT-RUN           | 223  | Verified by an agent-run e2e the agent performs itself; never delegated to the user        | —                                                                    | NONE                                        |
| BE-CAP-PLAN                | 228  | Surface wiring + agent-run step in the plan from the start                                 | —                                                                    | NONE                                        |
| BE-CAP-FRONTMATTER         | 235  | `capability: true` ⇒ no `user_execution: none`, and a real `user_execution_scenario:` path | `scan-capability-reachability.mjs`, `check-spec-doc-frontmatter.mjs` | NAMED                                       |
| BE-EXEC-ASK-FIRST          | 248  | "Can I execute this now?" answered before the scenario is written                          | —                                                                    | NONE                                        |
| BE-EXEC-REDESIGN           | 255  | Non-executable scenarios redesigned before being written                                   | —                                                                    | NONE                                        |
| BE-EXEC-MANUAL-REASON      | 259  | `manual-only:` requires a specific technical reason                                        | —                                                                    | NONE                                        |
| BE-EXEC-VIOLATION          | 263  | Unlabeled non-executable scenarios are a process violation                                 | —                                                                    | NONE                                        |
| BE-EVID-RUN-GATE           | 272  | Execute the scenario as a final gate before declaring complete                             | —                                                                    | NONE                                        |
| BE-EVID-NO-REWRITE         | 278  | Rewriting expected results to match observation is forbidden                               | —                                                                    | NONE                                        |
| BE-EVID-MANDATORY          | 282  | Observed evidence recorded before completion                                               | —                                                                    | NONE                                        |
| BE-EVID-DURABLE            | 288  | Evidence references durable repo artifacts; retired refs carry `evidence-superseded`       | `check-done-evidence.mjs`                                            | NAMED                                       |
| BE-DONE-ABSOLUTE           | 298  | No `status: done` until both done-gate stages pass                                         | `scan-unearned-done-claims.mjs`                                      | NAMED                                       |
| BE-DONE-S1                 | 305  | Stage 1: every scenario fully written                                                      | gate catalogue                                                       | NONE (prose gate)                           |
| BE-DONE-S2                 | 311  | Stage 2: every scenario executed with matching observed result                             | gate catalogue                                                       | NONE (prose gate)                           |
| BE-DONE-GUARD              | 316  | The verdict comes from the guard agent, never the actor                                    | `backlog-gate-guard`                                                 | NAMED                                       |
| BE-DONE-PROBE              | 321  | A capability-absence exception requires a recorded probe                                   | —                                                                    | NONE                                        |
| BE-DONE-NEVER-ENG          | 328  | Engineering verification is never user-execution evidence                                  | —                                                                    | NONE                                        |
| BE-DONE-MANUAL-LABEL       | 336  | Genuinely unexecutable ⇒ `manual-only` + reason before `done`                              | —                                                                    | NONE                                        |
| BE-DONE-REPORT             | 340  | Final response states command, expected result, evidence                                   | —                                                                    | NONE                                        |
| BE-COMPLETE-ATOMIC         | 348  | `status: done` + `completed:` + `git mv` in the same commit                                | `check-backlog-placement.mjs`                                        | NAMED                                       |
| BE-STATUS-FRONTMATTER-ONLY | 363  | Status only in frontmatter; body `## Status` banned                                        | —                                                                    | NONE                                        |
| BE-STATUS-PLACEMENT        | 365  | Terminal status ⇔ `completed/`                                                             | `check-backlog-placement.mjs`                                        | NAMED                                       |
| BE-STATUS-GATE-ORDER       | 367  | `done` not set before the gate passes                                                      | —                                                                    | NONE                                        |
| BE-STATUS-CLOSE-LOOP       | 370  | Evidence, status, move, gates close in the same change; follow-ons name a real file        | `backlog-placement` + `task-archival`                                | NAMED                                       |
| BE-BASE-BRANCH             | 381  | Child PR merges only when content matches its gate; green checks do not authorize          | —                                                                    | NONE                                        |
| BE-NO-AUTOMERGE            | 384  | The final initiative PR is never auto-merged                                               | —                                                                    | NONE                                        |
| BE-LAYERING                | 392  | Preserve owner boundaries (CLI / SDK / command packages)                                   | `check-command-layering.mjs`                                         | NAMED                                       |
| BE-SKILL-NO-ABSORB         | 399  | Skills must not absorb invoked skills' behavior                                            | —                                                                    | NONE                                        |
| BE-ORCH-THIN               | 404  | Orchestration skills stay thin                                                             | `enforcement-architecture.md`                                        | NONE                                        |
| BE-STOPCOND                | 419  | Twelve enumerated stop conditions halt the work                                            | —                                                                    | NONE                                        |

## 4.3 `spec-workflow.md` — 41 obligations

| RULE-ID                   | line | Obligation                                                                     | Mechanism                                                     | Verdict                                      |
| ------------------------- | ---- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------- |
| SW-SPEC-LIVING            | 12   | Contract-affecting PRs update `docs/SPEC.md` in the same PR                    | —                                                             | NONE                                         |
| SW-SPEC-INCOMPLETE        | 28   | A behavior change without a SPEC update is incomplete                          | —                                                             | NONE                                         |
| SW-SPEC-INCREMENTAL       | 30   | Never rewrite a whole SPEC for a localized change                              | —                                                             | NONE                                         |
| SW-SPEC-FIRST-INV         | 34   | SPEC section written before implementation; back-filling is a violation        | —                                                             | NONE                                         |
| SW-SPEC-DRIFT             | 38   | Drift schedules a dedicated catch-up item                                      | `spec-writing-standard` Mode C                                | NONE                                         |
| SW-CONTRACT-BOUNDARY      | 47   | Contract-boundary changes update the spec before code                          | —                                                             | NONE                                         |
| SW-SPEC-TESTPLAN          | 52   | Every spec change includes a verification test plan                            | —                                                             | NONE                                         |
| SW-NONCONFORM-BUG         | 53   | Non-conforming implementation is a bug                                         | —                                                             | NONE                                         |
| SW-DRAFT-FIRST            | 55   | New gap/fix/improvement starts as a draft spec doc                             | `backlog-writer` / `backlog-pipeline`                         | NONE                                         |
| SW-VALIDATED-REC          | 57   | Present a validated recommendation, not the first coherent design              | —                                                             | NONE                                         |
| SW-VAL-REACHABILITY       | 68   | Verify placement reachability by every intended consumer                       | —                                                             | NONE                                         |
| SW-VAL-CAPABILITY         | 70   | Prove every capability preserved or consciously dropped; a grep is not proof   | —                                                             | NONE                                         |
| SW-VAL-ADVERSARIAL        | 73   | Independent adversarial pass, each finding fixed/refuted/recorded              | —                                                             | NONE                                         |
| SW-VAL-RECORD             | 76   | Recorded in Architecture Review before GATE-APPROVAL                           | —                                                             | NONE                                         |
| SW-PLACE-MIRROR           | 88   | New surface mirrors the closest structural analog or justifies differing       | —                                                             | NONE                                         |
| SW-PLACE-SHARED-CORE      | 92   | New surface consumes shared core, never a skin on a sibling product            | —                                                             | NONE                                         |
| SW-PLACE-INDEPENDENT      | 96   | Placement validated by an independent architecture review, verdict recorded    | `architecture-auditor` / `proposal-reviewer`                  | NONE                                         |
| SW-PLACE-OWNER-FIRST      | 101  | Placement surfaced to the owner first                                          | —                                                             | NONE                                         |
| SW-PLACE-RECORD           | 106  | All four placement items recorded before GATE-APPROVAL                         | —                                                             | NONE                                         |
| SW-UREQ-GATE              | 109  | Explore→draft→gate→implement regardless of phrasing. Zero exceptions           | `user-request-gate` skill                                     | NONE                                         |
| SW-UREQ-NO-CODE           | 120  | No `.ts/.tsx/.js/.mjs` writes before a spec exists                             | `.claude/hooks/spec-first-gate.sh`                            | **WEAK-SCOPE (W6)** — advisory, cannot block |
| SW-UREQ-WAIVER            | 131  | A user waiver is acknowledged and noted as an exception                        | —                                                             | NONE                                         |
| SW-HARDGATE               | 137  | The full gate chain applies including to one-line fixes. No exceptions         | `backlog-pipeline`, gate catalogue                            | NONE                                         |
| SW-STATUS-FOLDER          | 153  | Status⇔folder mapping owned here; a gate PASS changes both or neither          | `check-backlog-placement.mjs`                                 | NAMED                                        |
| SW-GATE-EVIDENCE          | 172  | Every gate leaves an Evidence Log entry                                        | gate catalogue                                                | NONE                                         |
| SW-CONFORM-LOOP           | 183  | Contract changes followed by a conformance loop                                | `spec-code-conformance` skill                                 | NONE                                         |
| SW-CONFORM-FIXCODE        | 184  | The loop fixes code, not the spec                                              | —                                                             | NONE                                         |
| SW-CONFORM-TEST           | 185  | Each code fix includes a contract test                                         | —                                                             | NONE                                         |
| SW-CONFORM-ZERO           | 186  | Repeat to zero discrepancies, then regression tests pass                       | —                                                             | NONE                                         |
| SW-CODE-AFTER-SPEC        | 188  | Any code change preceded by a spec update                                      | —                                                             | NONE                                         |
| SW-ABSOLUTE-NO-SPEC-EDIT  | 191  | Always fix code to match SPEC; never SPEC to match code                        | —                                                             | NONE                                         |
| SW-SPEC-WRONG-PROC        | 196  | A wrong SPEC is corrected as a separate deliberate action                      | `spec-writing-standard` Mode C                                | NONE                                         |
| SW-REVERSE-VERIFY         | 210  | Boundary-affecting refactors reverse-verify the SPEC                           | —                                                             | NONE                                         |
| SW-DOC-AUTHORITY          | 219  | Each document class holds only its owned content                               | `check-document-authority.mjs`                                | NAMED                                        |
| SW-DOC-PROMOTE            | 243  | Accepted decisions promoted into the owner doc in the same PR                  | —                                                             | NONE                                         |
| SW-DOC-NO-DUP             | 247  | No duplicated API detail, no contract truth living only in README/task files   | —                                                             | NONE                                         |
| SW-STRUCT-DOCS            | 255  | Package composition changes update structural architecture docs in the same PR | `check-architecture-map-completeness.mjs`                     | NAMED                                        |
| SW-STRUCT-PKGMAP          | 258  | Composition/edge/mode/ownership changes update the package-local map           | `check-architecture-map-paths.mjs`                            | NAMED                                        |
| SW-STRUCT-NO-ROUTER-BLOAT | 259  | No subsystem detail appended to the map router                                 | —                                                             | NONE                                         |
| SW-GATE-CONFORMANCE       | 262  | GATE-CONFORMANCE passes only on a clean mechanical check with no open P0       | `pnpm harness:conformance` → `check-dependency-direction.mjs` | NAMED                                        |
| SW-XPKG-REF               | 284  | SPECs must not hardcode another package's counts/details                       | —                                                             | NONE                                         |

## 4.4 `publish.md` — 41 obligations

Mechanized subset (NAMED): PUB-RELEASE-RUN (`harness:release:init`), PUB-RELEASE-CHECK
(`harness:release:check --publish`), PUB-TRIAGE-NOTE (`harness:release:triage`), PUB-REPORT-GEN
(`harness:release:report`), PUB-CHANGELOG-GEN (`generate-release-notes.mjs --write-changelog`),
PUB-DEP-DIRECTION-GATE (`check-publish-safety.mjs` + `check-dependency-direction.mjs`), PUB-CMD-ONLY
(`pnpm publish:beta`), PUB-PNPM-ONLY (`prepublishOnly` → `check-pnpm-publish.sh`), PUB-SAFETY-GATE,
PUB-OTP-SEQUENCE (`npm-otp-publish` skill), PUB-DRYRUN-FULL, PUB-OTP-FORBIDDEN
(`harness:release:check` precondition), plus `check-release-governance.mjs` over the family — **12 NAMED.**

Unmechanized (NONE), 29 rows: PUB-CONTROL-PLANE (:23), PUB-STATE-FIELDS (:27), PUB-NO-OTP-UNCLEAR (:35),
PUB-PHASE-ORDER (:75), PUB-PROTECTED-APPROVAL (:76), PUB-BUMP-BRANCH (:77), PUB-NO-LOCK-EDIT (:78),
PUB-NO-MIX (:81), PUB-EXACT-SHA (:83), PUB-TRIAGE-BEFORE-FIX (:89), PUB-TRIAGE-CONTENT (:96),
PUB-NO-BLIND-PATCH (:105), PUB-WATCHER-TERMINATE (:114), PUB-DIST-ARTIFACT (:120), PUB-NO-PERPKG-BUILD
(:123), PUB-OTP-FLAG (:144), PUB-CMD-FORBIDDEN (:146), PUB-NO-TAG-FLAG (:151), PUB-ALL-TOGETHER (:161),
PUB-PKG-CHANGE-CHANGESET (:165), PUB-BUILD-BEFORE-DRYRUN (:170), PUB-STALE-LABELS (:172), PUB-ENV-FAILURE
(:195), PUB-BOUNDARY-STOP (:201), PUB-FAIL-CLASSIFY (:205), PUB-PRIVATE (:210), PUB-FIRST-APPROVAL (:211),
PUB-STOPCOND (:215), PUB-FINAL-REPORT (:228).

Publish is the best-mechanized rule area outside CI — the gap here is procedural (control plane, triage
notes, stop conditions), not structural.

## 4.5 `verification.md` — 40 obligations

| RULE-ID                    | line | Obligation                                                                | Mechanism                                   | Verdict                                            |
| -------------------------- | ---- | ------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| VER-BUILD-SCOPE            | 8    | Any `packages/*/src/` change requires an immediate scoped build           | —                                           | NONE                                               |
| VER-NO-BROKEN-COMMIT       | 9    | Never commit code that does not build                                     | —                                           | NONE                                               |
| VER-LOOP                   | 10   | change → build → test → fix → re-verify                                   | —                                           | NONE                                               |
| VER-BUILD-AFTER-COMMIT     | 11   | Build after every commit touching `packages/*/src/`                       | `pnpm build`                                | NONE                                               |
| VER-SUBAGENT-BUILD         | 12   | Subagents build after commit too                                          | —                                           | NONE                                               |
| VER-BROWSER                | 16   | Web-app changes verified in a browser before reporting completion         | Playwright MCP                              | NONE                                               |
| VER-BROWSER-CHECKS         | 18   | Page loads, elements visible, no console errors                           | —                                           | NONE                                               |
| VER-BROWSER-NONNEG         | 20   | Non-negotiable: no UI claim without browser verification                  | —                                           | **NONE** (no scan references browser verification) |
| VER-CODE-REVIEW-GATE       | 24   | `/code-review` with findings resolved before merge                        | `git-branch.md` gate                        | **WEAK-SCOPE (W1)**                                |
| VER-PREPUSH                | 30   | Never push without running affected local checks                          | `pnpm harness:pre-push`                     | NAMED                                              |
| VER-PREPUSH-SCOPE          | 32   | Default verifies directly changed scopes; expansion opt-in                | `HARNESS_PRE_PUSH_MODE=full`                | NAMED                                              |
| VER-NO-DUP-GATE            | 33   | Do not duplicate a stronger gate with a weaker one                        | —                                           | NONE                                               |
| VER-SKIP-NOOP              | 34   | Delete-only / tree-equivalent pushes skip package checks mechanically     | `pre-push.mjs` `decidePrePushVerification`  | NAMED                                              |
| VER-SKIP-CLEAN-ONLY        | 35   | Tree-equivalent skip valid only on a clean tree                           | `pre-push.mjs`                              | NAMED                                              |
| VER-FIX-LOCAL              | 37   | Fix failing scoped checks before pushing                                  | —                                           | NONE                                               |
| VER-BEHAVIORAL             | 42   | Generic checks insufficient for runtime-observable changes                | —                                           | NONE                                               |
| VER-STRUCTURED-EVIDENCE    | 44   | Structured runtime evidence required; prose does not count                | —                                           | NONE                                               |
| VER-HOOK-NOT-SUBSTITUTE    | 45   | The pre-push hook is a safety net, not the verification                   | —                                           | NONE                                               |
| VER-BLOCKER-REPORT         | 46   | Stop and report when verification cannot run locally                      | —                                           | NONE                                               |
| VER-RED-BEFORE-PUSH        | 47   | Defect-fix tests proven RED before push                                   | `check-regression-red-proof.mjs`            | **UNREACHABLE (U6)** — advisory, enforce var unset |
| VER-DELEGATED-HYPOTHESIS   | 55   | A green you did not observe is a hypothesis                               | —                                           | NONE                                               |
| VER-DELEGATED-RERUN        | 59   | Re-run affected gates in your own context before acting on delegated work | CI-equivalent entry point                   | **UNREACHABLE (U5)**                               |
| VER-HEADLESS               | 68   | CLI-affecting changes include a headless verification path                | —                                           | NONE                                               |
| VER-HEADLESS-NO-KEY        | 69   | Headless verification must not need a real API key                        | —                                           | NONE                                               |
| VER-HEADLESS-PROOF         | 70   | Model-routed tests prove structured execution                             | —                                           | NONE                                               |
| VER-BOTH-PATHS             | 71   | Verify both TUI and headless when both are affected                       | —                                           | NONE                                               |
| VER-ADD-FIXTURE            | 72   | Add a headless fixture if none exists, before pushing                     | —                                           | NONE                                               |
| VER-DETERMINISM            | 76   | Deterministic, termination-safe execution; non-determinism prohibited     | `operational.md` No Fallback                | NONE                                               |
| VER-CACHE                  | 82   | Caching only via an explicit audited policy with deterministic keys       | —                                           | NONE                                               |
| VER-HARNESS-COMPAT         | 88   | Harness changes backward-compatible with scenario records                 | —                                           | NONE                                               |
| VER-HARNESS-NONDESTRUCTIVE | 89   | No destructive record modification without `--force`/`--record`           | —                                           | NONE                                               |
| VER-OWNERSHIP-MAP          | 90   | Scenario ownership maps updated before verifying a new scope              | —                                           | NONE                                               |
| VER-HARNESS-ROLE           | 94   | Harness is advisory in dev, blocking at release gates                     | —                                           | NONE                                               |
| VER-PRE-EXISTING           | 96   | Pre-existing scan failures tracked and resolved                           | —                                           | NONE                                               |
| VER-BATCH-HARNESS          | 100  | Harness verification after every batch of changes                         | CI-equivalent entry point                   | **UNREACHABLE (U5)**                               |
| VER-NO-HANDLIST            | 101  | Do not substitute a hand-written command list                             | —                                           | NONE                                               |
| VER-RELEASE-VERIFY         | 105  | `pnpm harness:verify:release` for promotions                              | `release-grade verification` required check | NAMED                                              |
| VER-FIX-BEFORE-PROCEED     | 107  | Fix a failing stage before proceeding                                     | —                                           | NONE                                               |
| VER-REPORT-COUNTS          | 108  | Report harness results with counts                                        | —                                           | NONE                                               |
| VER-BLOCKING-MAIN          | 109  | No merge to `main`/`release/*` without a harness pass                     | `release-grade verification`                | NAMED                                              |

## 4.6 `code-quality.md` — 31 obligations

`NAMED`: CQ-NO-FAKE-IN-SRC (:30, `scan-no-fake-in-src.mjs`), CQ-FILE-SIZE (:46, `scan-file-size.mjs`
ratchet over `packages`/`apps`), CQ-ANTI-MONOLITH (:47, same scan), CQ-NO-ANY (:9) and CQ-NO-CONSOLE
(:39) via ESLint `"error"` (`.eslintrc.json:23`, `:57`), CQ-LOWEST-LAYER / CQ-SSOT-OWNER partially via
`check-dependency-direction.mjs` and `check-interface-imports.mjs` — **6 NAMED.**

**CQ-NO-TSIGNORE (:11) is WEAK-SCOPE (W5)** — `ban-ts-comment` is `"warn"` and nothing passes
`--max-warnings=0`.

The remaining 24 are **NONE**: CQ-STRICT (:8), CQ-UNKNOWN-NARROW (:10), CQ-PREFIX (:12), CQ-TEST-ANY
(:13), CQ-NO-TYPE-DUP (:15), CQ-NO-WRAPPER-ALIAS (:17), CQ-OVERLAP-TYPE (:18), CQ-NO-TRIVIAL-ALIAS (:19),
CQ-INTERFACE-SHAPES (:20), CQ-UNDEFINED (:21), CQ-STATIC-IMPORTS (:25), CQ-DYNAMIC-IMPORT (:26), CQ-DI
(:40), CQ-NO-BLIND-ASSERT (:41), CQ-SEPARATE-CONCERNS (:42), CQ-READONLY (:43), CQ-NO-PARAM-MUTATION
(:44), CQ-NO-MAGIC (:45), CQ-PARALLEL-COLLECTIONS (:48), CQ-HOOK-TIMING (:49), CQ-PROPER-ARCH (:50),
CQ-LEGACY-DISPOSABLE (:51), plus the two SSOT rows above where the scan covers direction but not
duplication.

Note: the No-Fallback pre-write floor for this area (`check-forbidden-patterns.sh`) is **UNREACHABLE (U4)**
in worktree sessions; `scan-no-fallback.mjs` remains the CI-side floor and is registered.

## 4.7 `operational.md` — 29 obligations

`NAMED`: OPS-FEATURE-DOCS / OPS-FEATURE-INCOMPLETE (:32, :39 — `harness:scan:specs`), OPS-DOC-SIZE-EXEMPT
(:56 — file-size scan), OPS-API-SPEC (:96 — `api-spec-management` skill). The No Fallback family
(OPS-NO-FALLBACK :9, OPS-NO-CATCH-FALLBACK :10, OPS-NO-OR-FALLBACK :11, OPS-TERMINAL :12, OPS-RETRY-GATE
:13) names no mechanism in the rule text but **is** mechanized by `scan-no-fallback.mjs` (registered) plus
the `check-forbidden-patterns.sh` pre-write floor — **the scan holds; the hook is UNREACHABLE (U4).**

`NONE` (21): OPS-RESULT-TYPE (:14), OPS-IDEA-CAPTURE (:18), OPS-IDEA-CONTINUE (:20), OPS-OPTIONS-REC
(:26), OPS-OPTIONS-IMPACT (:27), OPS-ID-CONVENTION (:44 — no scan checks the `{DOMAIN}-{NNN}` filename
pattern; **this is the mechanism gap behind the four ID collisions in one day**), OPS-DOC-SIZE-ROUTER
(:55), OPS-SEARCH-DISCIPLINE (:64), OPS-UNRECOGNIZED (:67), OPS-LOOKUP-SCALE (:69), OPS-FETCH-EXACT
(:71), OPS-NO-FABRICATION (:76), OPS-REPO-FIRST (:77), OPS-SKEPTICAL (:80), OPS-FILE-MINIMAL (:84),
OPS-EDIT-TARGET (:86), OPS-NO-PHANTOM-FILE (:87), OPS-SIGNALS (:100), OPS-SHUTDOWN-TIMEOUT (:101),
OPS-RESOURCE-RELEASE (:102).

## 4.8 `common-mistakes.md` — 82 entries

Mechanized (NAMED), 21 entries: CM-02, CM-05, CM-06, CM-08, CM-11, CM-12, CM-26, CM-27, CM-28, CM-41,
CM-42, CM-50, CM-51, CM-52, CM-56, CM-58, CM-59, CM-60, CM-62, CM-73, CM-74, CM-76, CM-77 (the last
group via `check-task-archival.mjs`, `check-backlog-placement.mjs`, `check-test-module-mocks.mjs`,
`run-all-scans.mjs` parallelism, and named package tests).

**CM-82** (regression test proven RED) names "PR-review guardian re-run against base" — that is a model
judgment, and its mechanical counterpart is **UNREACHABLE (U6)**.

The other ~58 entries are **NONE** — pointer rows restating a rule with no independent mechanism.

**Calibration finding:** of 82 entries, 57 carry no incident citation and exactly one (`#71`) cites a PR
number. **No entry covers branch/base cutting, promotion ancestry, CI-mirror divergence, or vacuous
required checks** — the top three measured rework drivers. The dated entries stop at 2026-07-12; the
entire 2026-07-24→27 gate-validity class lives only in `.agents/memory/`, never promoted into the catalogue.

## 4.9 `documentation-sync.md` (18) · `learning-loop.md` (17) · `memory-mirroring.md` (7) · `research.md` (18)

| Area                    | Mechanized                                                                                                                                                                               | Verdict summary                                                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documentation-sync.md` | DS-DOCS-BUILD (:71, `pnpm docs:build`); DS-MAP-SCOPE (:14) via `check-document-authority.mjs`; DS-PKG-DOC-GATE family partially via `check-doc-examples.mjs` / `audit-spec-coverage.mjs` | 3 NAMED, **15 NONE** — including DS-PKG-README (:61), DS-CONTENT-PAGE (:66), DS-NO-STALE-PUBLISH (:73) and DS-MAP-NO-LOSS (:34)                                                                                                  |
| `learning-loop.md`      | LL-INVOKE / LL-NOT-CLOSED-BY-INSTANCE name the `lesson-to-harness` skill; LL-TWO-TERMINAL-STATES names the scan/hook/test class generically                                              | 3 NAMED, **14 NONE**. **LL-PROVE-CHECK (:32) — "a new check MUST demonstrably FAIL on the triggering incident" — has no mechanism, which is exactly how U1-U4 shipped with passing tests that never reproduced the real shape.** |
| `memory-mirroring.md`   | MM-MIRROR / MM-POINTER via `scan-memory-mirror.mjs` (repo-side index/orphan invariant) + `memory-mirror-reminder.sh` (advisory, `exit 0` only)                                           | 2 NAMED, **5 NONE**. The scan is honest that it covers only the repo-side half; the cross-boundary half is an advisory echo that cannot block.                                                                                   |
| `research.md`           | RS-DEFAULT-ON / RS-WGF via `scan-spec-research.mjs` (registered) + `prior-art-researcher` + GATE-WRITE                                                                                   | 2 NAMED, **16 NONE** — RS-NO-SOURCE-CODE (:13), RS-CITE (:21), RS-NOT-EASIEST (:28) and the rest are prose.                                                                                                                      |

## 4.10 `agent-conduct.md` (23) · `naming-style.md` (5) · `frontend.md` (8) · `tdd-and-planning.md` (15) · `testing-layering.md` (6)

| Area                  | Mechanized                                                                                                         | Verdict summary                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-conduct.md`    | AC-QUANTIFIED (:41) via `scan-progress-report-quantification.mjs`; AC-LANGUAGE (:18) points at `naming-style.md`   | 1 NAMED, **22 NONE**. Conduct is largely unmechanizable by nature — this is the one area where a high NONE count is expected rather than a defect.                |
| `naming-style.md`     | NS-AGENT-IDENTITY (:25) via `scan-conflict-markers.mjs:26` (`/main agent\|sub-agent\|parent-agent\|child-agent/i`) | 1 NAMED, 4 NONE. **NS-STYLING (:30, Tailwind-only)** has no scan and no ESLint rule found.                                                                        |
| `frontend.md`         | none found                                                                                                         | **8 NONE** — including FE-TAILWIND-ONLY (:32) and FE-PREFETCH-WRAPPER (:22), the latter being common-mistakes #64, a repeat incident.                             |
| `tdd-and-planning.md` | TDD-SCAN (:31) via `scan-test-plan.mjs`; TDD-PRE-REFACTOR (:22) via a skill                                        | 1 NAMED → **WEAK-SCOPE (W2)**, 14 NONE. TDD-PROVE-RED (:12) → **UNREACHABLE (U6)**. TDD-PLAN-DOC (:35) mandates `docs/plans/`, which the only scan does not read. |
| `testing-layering.md` | TL-MANIFEST (:22) via `check-functional-coverage.mjs`                                                              | 1 → **WEAK-SCOPE (W3)**, 5 NONE.                                                                                                                                  |

## 4.11 Pointer stubs

`process.md`, `api-boundary.md` carry no independent obligations. `release-operations.md` is a stub whose
content moved to `publish.md` and remains guarded by `check-release-governance.mjs`.

---

# Part 5 — Proposed remediation (described, not filed — no IDs assigned)

## In-flight overlap — read this before filing anything

Checked against open PRs at the moment this audit was written. **PR #1514
(`fix/hook-reachability-audit`) and PR #1510 (`fix/push-guard-unreachable-in-compound-commands`) are
already remediating a large part of Part 1**, independently and concurrently:

| Finding                                              | Covered by #1514 / #1510?                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U1 — `branch-guard.sh` anchoring                     | **Yes**                                                                                                                                                |
| U2 — `pre-push-check.sh` anchoring                   | **Yes** (both PRs)                                                                                                                                     |
| U4 — `check-forbidden-patterns.sh` scope filter      | **Yes** — rewritten to match the path's shape rather than a `CLAUDE_PROJECT_DIR` prefix; also closes a `MultiEdit` matcher gap this audit did not find |
| Proposal 2 — hook↔`settings.json` registration floor | **Yes** — `scripts/harness/__tests__/hook-command-reachability.test.mjs` asserts every hook is registered or verifiably chained from one that is       |
| U3 — `ROBOTA_AGENT_WORKTREE` never set in production | **No.** The diff still sets the marker only inside test fixtures; the guard continues to fail open in a real worktree session                          |
| U5, U6, U7, U8                                       | **No**                                                                                                                                                 |
| W1-W6                                                | **No**                                                                                                                                                 |

So the anchoring class is being closed as this audit lands, by a fix that arrived at the same defect from
the other direction. **That convergence is itself the strongest evidence for the audit's thesis:** two
independent passes over the same harness both landed on "registered but unreachable" as the dominant
defect. What remains open below is the residue that fix does not reach.

## Items

Ordered by measured rework, not by ease.

1. ~~**De-anchor the Bash hook command matchers.**~~ **Superseded by #1514 / #1510.** Verify at review
   that the fixture proves the rule's own prescribed command (`git fetch origin && git checkout -b …`)
   goes from pass to block, rather than only testing a `cd`-prefixed form.
2. ~~**Give `.claude/hooks/` the floor `scripts/harness/` has.**~~ **Substantially covered by #1514's
   `hook-command-reachability.test.mjs`.** Residue worth confirming at review: it is a test, not a
   registered scan, so it gates `harness:test` (which CI runs) but not `pnpm harness:scan`. Confirm that
   is intentional.
3. **Make hook fixtures reproduce the worktree geometry.** Every hook fixture must include a case where
   `CLAUDE_PROJECT_DIR` is the main clone and the target path is inside `.claude/worktrees/`.
   `self-check.mjs:83-93` still constructs its fixture path under `projectDir` and so cannot exercise the
   mismatch even after #1514 fixes the hook it is testing.
4. **Resolve `worktree-cwd-guard`'s marker.** Either have the launcher export `ROBOTA_AGENT_WORKTREE`, or
   re-derive the assignment from the hook-input `cwd` (which _is_ available), or retire the guard. Shipping
   a passing test suite over a guard that cannot fire is worse than not having it.
5. **Add a create-time base check** for "cut from freshly-fetched `origin/develop`" —
   `git merge-base --is-ancestor origin/develop HEAD` at branch creation. Today no mechanism checks the
   start point at any moment.
6. **Order `verify-like-ci`'s `typecheck` stage after `build`** (or gate it on a present `dist/`). Until
   then the mandated gate cannot go green on a docs-only branch in a fresh worktree — see U8, reproduced
   by this audit's own run. Fix this before #7, because a red-by-default gate cannot be made mandatory.
7. **Force `verify-like-ci` to be run, or stop naming it as the gate.** Options: invoke it from
   `pre-push.mjs` behind the same skip logic, or require a recorded run artifact on the PR. Leaving a
   command documented as mandatory and invoked by nothing is the shape that produced two failed promotions.
8. **A merged-branch cleanup scan.** 48 standing merged branches is a mechanically detectable state.
9. **Point `scan-test-plan` at `docs/plans/`** — the location its own governing rule mandates. Expect 13
   pre-existing findings; the ratchet pattern already used elsewhere applies.
10. **Decide on the `/code-review` gate.** Either give "zero exceptions" a runtime mechanism (a recorded
    review artifact per PR) or soften the wording. A contract-presence scan is not a floor.
11. **Reconcile the two rules whose stated bound is stricter than the configured one** — the commit-subject
    limit (rule 72, commitlint 100) and `ban-ts-comment` (rule "PROHIBITED", ESLint `"warn"` with no
    `--max-warnings=0`). Either tighten the config or correct the rule text; a rule that reads absolute
    over a mechanism that cannot fail is the shape this whole audit is about.
12. **Recalibrate `common-mistakes.md`.** Of 82 entries, 57 are pointer rows with no incident citation and
    exactly one cites a PR number, while the top three measured rework drivers — branch/base cutting,
    CI-mirror divergence, and vacuous required checks — have **no entry at all**. The catalogue is indexing
    a different failure distribution than the one the repo is actually paying for.
