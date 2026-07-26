---
id: HARNESS-052
title: 'HARNESS-052: sweep for checks that report success over work they did not do'
status: in-progress
priority: high
urgency: soon
type: INFRA
area: scripts/harness, .github/workflows, .claude/hooks, packages
created: 2026-07-26
depends_on: []
---

## Problem

One defect class has hit this repository ten times in a week: **a check that reports success over
work it did not do**. Not a check that is wrong — a check that is *silent*, so the absence of
enforcement is invisible from outside. `Claude review` skipping on a parity mismatch and exiting 0
for 100 consecutive runs; `scans` printing `SKIPPED … Not a pass` and exiting 0; a red `changes`
making required jobs report `skipping`, which branch protection accepts; `protect-main`'s five
required contexts being three-second echoes; `verify-like-ci` named as THE CI mirror while running
neither `build` nor any package test.

Nine guards now fence specific instances (`scan-review-workflow-parity`, `scan-ci-base-history`,
`scan-main-required-checks`, `scan-automerge-disarm-permission`, `scan-unearned-done-claims`,
`check-regression-red-proof`, `ci-mirror-map`, `scan-no-fallback`, `scan-no-fake-in-src`). This item
records a systematic sweep of the gaps *between* them.

**Method.** Every finding below marked `falsified` was reproduced by breaking the thing the check
exists to catch, running the check, and recording whether it went red. Findings marked `hypothesis`
were reasoned about but not executed, and are labelled as such — an audit that presents unfalsified
reasoning as measurement is this defect class one level up.

## Findings

### Fixed in this item (each proven RED before the fix, GREEN after)

| # | Location | Shape | Verdict | Reachable |
| - | -------- | ----- | ------- | --------- |
| F1 | `scripts/harness/scan-ci-base-history.mjs` `listWorkflows` | `if (!existsSync(dir)) return []` — a missing `.github/workflows` reported as a pass | falsified | yes |
| F2 | `scripts/harness/scan-automerge-disarm-permission.mjs` | inherits F1 via the shared helper | falsified | yes |
| F3 | `scripts/harness/scan-review-workflow-parity.mjs` `listGovernedWorkflows` | same, plus: **zero workflows matching the governed action printed "nothing to guard" and exited 0**, so renaming or wrapping the action retires the guard silently | falsified | yes |
| F4 | `scripts/harness/scan-no-fallback.mjs` | absent `packages/` ⇒ `no-fallback scan passed.`; separately, the `root` parameter was decorative — the walker always walked `WORKSPACE_ROOT` | falsified | yes |
| F5 | `scripts/harness/scan-no-fake-in-src.mjs` | absent `packages/` ⇒ zero findings ⇒ pass | falsified | yes |
| F6 | `scripts/harness/check-patch-coverage.mjs:388` | **any** `--detect` error (most reachably an unresolvable base ref) wrote `affected=false` to `$GITHUB_OUTPUT` and exited 0, so ci.yml skipped collection and published a green patch-coverage result over an unmeasured diff | falsified | yes |
| F7 | `packages/agent-core/src/agents/robota.test.ts:503` | `expect(true).toBe(true)` under the title "should handle multiple destroy calls safely" | falsified | yes |
| F8 | `packages/agent-provider-openai/src/openai/executor-integration.test.ts:140` | `expect(true).toBe(true)` under "should clean up executor when provider is disposed" — a claim `OpenAIProvider.dispose()` does not make; it is empty | falsified | yes |

F6's falsification: `PATCH_COVERAGE_BASE_REF=origin/no-such-branch-xyz node scripts/harness/check-patch-coverage.mjs --detect`
wrote `affected=false` / `packages=` and exited 0. After the fix the same command exits 1 and writes nothing.

F7's repair was itself red-proofed: deleting the `if (this.destroyed) return { errors: [] }` guard
from `packages/agent-core/src/core/robota.ts` makes the repaired test fail
(`expected "dispose" to be called 1 times, but got 2 times`). The source was restored.

### Found, NOT fixed — recorded with the reason

**Harness scans that report a pass over an absent governed tree** — nine more, all `falsified` by
executing each finder against a root without its tree. They are listed with their measurements in
`PENDING_CLASSIFICATION` in `scripts/harness/scan-guard-scope-fail-closed.mjs`, so they cannot be
forgotten: `scan-orchestration-neutrality`, `check-harness-config-paths`, `scan-conflict-markers`,
`scan-api-pagination`, `scan-memory-neutrality`, `scan-evals-neutrality`,
`scan-capability-reachability`, `scan-deprecated-markers`, `check-temp-script-placement`. Not fixed
here to keep this item's diff reviewable; each needs its governed root named accurately.

**`check-design-doc-completeness` has never validated a document** (`falsified`: `ls -d
packages/*/docs/design` matches nothing; the scan prints `design-doc completeness scan passed.` and
has done so since it was written). Fixing it is a policy decision — either design docs become
required somewhere, or the scan declares its subject optional — not a mechanical repair.

**Six scans read `packages/` at depth 1 and never see the 20 `packages/dag-nodes/*` members**
(`check-interface-imports`, `check-dep-kind`, `check-orphan-exports`, `scan-no-fake-in-src`,
`scan-memory-neutrality`, `check-design-doc-completeness`), while `check-publish-safety` prints the
literal claim "Checked prepublishOnly hooks on all publishable packages" having checked 65 of 85.
`scripts/harness/workspace-packages.mjs` already solves this and five other scans use it.
`hypothesis` that a violation is hiding there — a probe found none today; the false coverage claim is
the finding. Note `check-nested-package-glob-coverage.mjs` exists to catch exactly this shape and
does not cover these six.

**`run-all-scans` has no third state between ✓ and ✗.** Passing scans' output is discarded
(`run-all-scans.mjs:260`), so a scan that ran and measured nothing is rendered identically to one
that ran and found nothing. Three registered scans print a skip notice today and are invisible:
`promotion-ancestry` (skips on every non-`main` PR), `progress-report-quantification` (`falsified`:
skips in every `.claude/worktrees/*` session — i.e. exactly the sessions it judges — and in CI), and
`scan-legacy-typescript`'s careful `undefined`-not-`[]` result, which its own caller downgrades to a
notice on a 0-exit run. `--skip` has the same shape: the summary reads `all N scans passed` with N
silently reduced.

**`verify-change.mjs:105`** — a resolved change set that maps to zero package scopes still exits 0
having built, tested and linted nothing. The base-ref half of INFRA-056 was closed; this half was not.

**`check-plan.mjs:97,100`** — `needsTest && scope.scripts.test` and `needsLint && scope.scripts.lint`
drop the check when the script is *absent*, whereas `needsTypecheck` pushes unconditionally. So a PR
confined to `packages/agent-cli-web` (no `test` script) means root `pnpm test` never runs at all, and
a PR confined to any of the 16 packages without a `lint` script means root `pnpm lint` never runs.
`hypothesis` — the code path is read, not executed. Not fixed here: the fix changes what CI runs on
real PRs and deserves its own item.

**`packages/dag-builder` has 565 lines of production logic and zero test files**, behind
`vitest run --passWithNoTests`. It is the only one of the 70 `--passWithNoTests` packages where the
flag is load-bearing, and it is imported by 19+ modules. Product change — filed, not made.

**`packages/agent-cli-web/package.json:12` defines `test:e2e` that nothing invokes**, and the package
has no `test` script, so root `pnpm test` skips it entirely.

**`.claude/hooks/check-forbidden-patterns.sh` is inert for worktree agents** (`falsified`). Its scope
filter is `case "$FILE_PATH" in "$PROJECT_DIR"/packages/*/src/*.ts)`, and `PROJECT_DIR` is
`${CLAUDE_PROJECT_DIR:-.}`. Measured: a payload writing a `catch { return null; }` into
`<repo>/packages/agent-core/src/probe.ts` exits **2** (blocked), the identical payload under
`<repo>/.claude/worktrees/<agent>/packages/...` exits **0**, and with `CLAUDE_PROJECT_DIR` unset the
hook exits 0 for *every* write. This repo's own orchestration policy puts agent work in
`.claude/worktrees/*`, so the pre-write floor is off for most of the work it governs.
`branch-guard.sh` and `worktree-cwd-guard.sh` were both already repaired for this exact shape;
this one was missed. Outside this item's ownership — file only.

**Workflow findings**, from a full read of the 13 workflows (`claude-code-review.yml` excluded —
another agent owns it). All `hypothesis`: they describe GitHub-side behaviour that cannot be
falsified from a local checkout.

- `review-gate.yml:38` `types: [opened, synchronize, reopened, labeled, unlabeled]` omits `edited`.
  This is `scan-main-required-checks`' own R7 rule, unenforced: R7 is scoped to `main`
  (`GOVERNED_BRANCH = 'main'`) and `review-gate` is required on `develop`. A base retarget leaves a
  verdict computed against a different base satisfying the required context.
- `codeql.yml:9` declares no `types:` at all, so it inherits a default set without `edited` —
  compounding the above.
- `ci.yml:570,606,645` — `examples-typecheck`, `windows-shell` and `tui-e2e` are required on
  `develop` and gated on `needs.changes.outputs.code`, but `changes` is not itself a required
  context. ci.yml:149 documents the consequence in its own words. Adding `changes` to the required
  list costs nothing.
- `ci.yml:260` — `build` (required) is `pnpm build` behind an `if:`, with an `echo` on the else
  branch. This is the `protect-main` incident's shape on the develop side, and
  `scan-main-required-checks`' R3/R4 cannot see it: R3 matches only `github.base_ref` in a step
  `if:`, and R4 requires *every* step to be conditional. `ci.yml:431` (`security audit`, required)
  has the same shape.
- `review-gate.yml:260` — the auto-merge disarm is `needs.review-gate.result == 'failure'`, but the
  workflow sets `cancel-in-progress: true` and triggers on `labeled`, so a cancelled run leaves auto
  merge armed. `'cancelled'` and `'skipped'` belong in that condition.
- `ruleset-drift.yml:20` — `permissions: contents: read` while the job reads a repository ruleset,
  which needs `administration: read`. Fails loudly on a hard 403, but a partial read reports every
  declared context as "enforcing nothing" — and this cron is the only thing watching for ruleset drift.
- `gitleaks.yml:22` — the whole job sits behind a fork check, so fork PRs get a `skipped` context.
- `live-provider-smoke.yml` and `mutation-nightly.yml` are declared green no-ops; both are declared,
  non-required, and correctly excluded from the required lists.

## Second axis — the check runs, can fail, and measures the wrong thing

Added mid-sweep by the owner. A gate that genuinely can go red is still broken if what it fails on is
not what its name promises. Three sub-shapes: **(A)** checks something other than its name claims,
**(B)** over-checks beyond its purpose — a noisy gate gets bypassed, costing more than it catches,
**(C)** criteria that drifted — right once, then the code moved.

`check-agent-server-boundary` is the owner's worked example and is already filed as HARNESS-051: it
passes, it can fail, and it is satisfied vacuously by a never-called import because it checks that a
token *appears* rather than that a seam is *wired*. Not duplicated here.

### Fixed in this item

| # | Location | Sub-shape | Verdict |
| - | -------- | --------- | ------- |
| G1 | `scripts/harness/check-publish-safety.mjs:91` | A + C | falsified |
| G2 | `scripts/harness/scan-dist-freshness.mjs:1` | A | falsified |

**G1 — a universal claim over a set enumerated at depth 1.** The scan printed `Checked prepublishOnly
hooks on all publishable packages` while enumerating `readdirSync(join(root, 'packages'))`, so the 20
members of `packages/dag-nodes/*` were outside the set its claim covered. Both sub-shapes at once:
the message says "all" (A), and the enumeration predates the nested group (C). Falsified by making
`packages/dag-nodes/tool` publishable and deleting its `prepublishOnly` hook — the scan printed the
"all publishable packages" line and exited 0. After the fix the same mutation exits 1 naming
`@robota-sdk/dag-node-tool`, and the message reports the count it actually covered (76). Rule 1 of
the same file already used the nesting-aware SSOT enumerator; rule 2 had never adopted it.

**G2 — a presence gate wearing a temporal name.** `scan-dist-freshness` never compares dist against
the sources that produced it. Falsified: `touch packages/agent-core/src/index.ts` leaves the source
28 minutes newer than its dist and the scan still exits 0, reporting "All 86 buildable packages have
dist/". The behaviour is a correct presence gate; the *name* is the defect. Not renamed here — the
registered name `dist` appears in a `--skip dist` argument inside `ci.yml`, which is outside this
item's ownership — so the docstring now states the gap explicitly instead of implying the check.
`verify-like-ci` already compensates: its `build` stage exists because "locally a STALE dist passes
the presence-only freshness scan", and it rebuilds rather than trusting this result.

### Guarded

`scripts/harness/workspace-packages.mjs` is the SSOT every nesting-aware scan enumerates through, so
each scan's coverage is exactly as correct as that module's — and its rule is a *heuristic* (recurse
one level into a depth-1 directory that is not itself a package), not a reading of
`pnpm-workspace.yaml`. The two could drift apart silently, which is how G1 happened.
`scripts/harness/__tests__/workspace-packages.test.mjs` now pins them together, deriving the expected
set from the manifest rather than from the same recursion under test. Red-proofed: removing the
nested recursion fails 3 of 5 cases and names all 20 dropped packages. The one-level recursion
ceiling is asserted too, so it is a known boundary rather than a surprise.

### Recorded, not fixed

- **The `dist` scan should be renamed** to match what it measures, which requires the `--skip dist`
  argument in `ci.yml` to move with it.
- **Five more depth-1 `packages/` walkers** (`check-interface-imports`, `check-dep-kind`,
  `check-orphan-exports`, `scan-memory-neutrality`, `check-design-doc-completeness`) have G1's shape.
  `hypothesis` for each — only `check-publish-safety` was falsified. A probe found no live violation
  hiding in the uncovered packages today; the false coverage is the finding, not a current miss.
- **`check-design-doc-completeness` has never validated a document** and is also a depth-1 walker, so
  it carries both axes at once: it cannot fail today, and its subject is the wrong set.

## The mechanical ceiling

Stated rather than implied, because an audit claiming completeness it cannot have is itself the defect:

- **A weak assertion is not detectable by pattern.** `scan-tautological-assertions` catches only
  assertions that are *structurally* incapable of failing. Several tests found in this sweep assert a
  run reached `status: 'success'` while never checking the value the run was supposed to produce
  (`packages/dag-framework/src/__tests__/create-dag-framework.test.ts:46,79` — a DAG configured with
  `prefix: 'hello '` over input `'world'` where `'hello world'` appears in no assertion). Only
  mutation testing reaches those.
- **A scan whose logic is subtly wrong still passes.** `scan-guard-scope-fail-closed` asserts a
  guard fails closed when its governed tree is *absent*; it says nothing about whether the guard's
  rules are correct when the tree is present.
- **Scans that walk their tree inline in `main()`, or take no root parameter, are outside the new
  guard's derived set.** It covers 20 of ~70 registered scans, by construction, and says so in its
  output.
- **GitHub-side behaviour cannot be falsified locally.** Every workflow finding above is a hypothesis.
- **A name/behaviour mismatch is not mechanically detectable at all.** The second axis was audited by
  reading, and only two of its findings were falsified. No scan can decide whether a check's name
  describes what it measures — that is a judgement about intent. G1 was found because its message
  contained the word "all"; a check whose name is merely *optimistic* leaves no such token.
- **Over-checking (sub-shape B) produced no confirmed finding here**, which is a statement about this
  sweep's reach, not evidence that none exists: suppression counts and gate runtimes were surveyed,
  but "noisy enough that people route around it" is measured from behaviour over time, not source.

## Test Plan

- `scripts/harness/__tests__/scan-tautological-assertions.test.mjs` — 35 cases, including the literal
  line from the `dag-framework` incident as a regression fixture, and the absent-governed-tree case
  for the scan itself.
- `scripts/harness/__tests__/scan-guard-scope-fail-closed.test.mjs` — 14 cases, including one
  per repaired guard asserting it no longer reports a pass over a tree it never read.
- `pnpm harness:scan` (72 scans), `pnpm harness:test` (90 files / 1176 tests),
  `pnpm harness:verify-like-ci`.

## User Execution Test Scenarios

Not applicable. This item changes harness guards, harness scripts and test assertions only. It
delivers no runnable user-facing behaviour — no CLI command, TUI action, browser flow or public SDK
surface changes. The verification that matters is the red/green proof recorded above, which belongs
in `## Test Plan`.

## Acceptance

- [x] `scan-tautological-assertions` registered, proven RED on the two live instances and GREEN after.
- [x] `scan-guard-scope-fail-closed` registered, proven RED on five live instances and GREEN after.
- [x] `check-patch-coverage --detect` no longer answers `affected=false` from a failed detection.
- [x] `check-publish-safety` enumerates the workspace's real package set, and its message states the
      count it covered.
- [x] The SSOT package enumerator is pinned to the workspace declaration by a red-proofed test.
- [x] `scan-dist-freshness`' docstring states what it does not measure.
- [ ] `scan-dist-freshness` is renamed to match what it checks (needs the `--skip dist` argument in
      `ci.yml` to move with it — outside this item's ownership).
- [ ] The five remaining depth-1 `packages/` walkers adopt `workspace-packages.mjs`.
- [ ] The nine remaining vacuous finders in `PENDING_CLASSIFICATION` fail closed.
- [ ] `check-design-doc-completeness`' subject is decided — required somewhere, or declared optional.
- [ ] The six depth-1 `packages/` walkers adopt `workspace-packages.mjs`.
- [ ] `run-all-scans` distinguishes "ran and found nothing" from "ran and measured nothing".
- [ ] `review-gate.yml` subscribes to `edited`; R7 is extended to `develop`'s required contexts.
- [ ] `changes` is a required context, or the three jobs it gates stop depending on it.
- [ ] `.claude/hooks/check-forbidden-patterns.sh` resolves worktree paths.
- [ ] `packages/dag-builder` has tests; `--passWithNoTests` is removed where it is load-bearing.

## References

- `.agents/backlog/HARNESS-051-dead-code-satisfies-architecture-gate.md` — records the same class
  from SEC-005's angle: the vacuously-satisfied `agent-server-boundary` gate, the test-file
  `no-unused-vars` exemption that hid the assertion-free tests, and `verify-change.mjs`'s `passed`
  field that is structurally always `true`. Not duplicated here.
- INFRA-048, INFRA-050, INFRA-055, INFRA-056, INFRA-057, HARNESS-041, HARNESS-050 — the ten instances.
