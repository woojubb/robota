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
work it did not do**. Not a check that is wrong — a check that is _silent_, so the absence of
enforcement is invisible from outside. `Claude review` skipping on a parity mismatch and exiting 0
for 100 consecutive runs; `scans` printing `SKIPPED … Not a pass` and exiting 0; a red `changes`
making required jobs report `skipping`, which branch protection accepts; `protect-main`'s five
required contexts being three-second echoes; `verify-like-ci` named as THE CI mirror while running
neither `build` nor any package test.

Nine guards now fence specific instances (`scan-review-workflow-parity`, `scan-ci-base-history`,
`scan-main-required-checks`, `scan-automerge-disarm-permission`, `scan-unearned-done-claims`,
`check-regression-red-proof`, `ci-mirror-map`, `scan-no-fallback`, `scan-no-fake-in-src`). This item
records a systematic sweep of the gaps _between_ them.

**Method.** Every finding below marked `falsified` was reproduced by breaking the thing the check
exists to catch, running the check, and recording whether it went red. Findings marked `hypothesis`
were reasoned about but not executed, and are labelled as such — an audit that presents unfalsified
reasoning as measurement is this defect class one level up.

## Findings

### Fixed in this item (each proven RED before the fix, GREEN after)

| #   | Location                                                                     | Shape                                                                                                                                                                                                                        | Verdict   | Reachable |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------- |
| F1  | `scripts/harness/scan-ci-base-history.mjs` `listWorkflows`                   | `if (!existsSync(dir)) return []` — a missing `.github/workflows` reported as a pass                                                                                                                                         | falsified | yes       |
| F2  | `scripts/harness/scan-automerge-disarm-permission.mjs`                       | inherits F1 via the shared helper                                                                                                                                                                                            | falsified | yes       |
| F3  | `scripts/harness/scan-review-workflow-parity.mjs` `listGovernedWorkflows`    | same, plus: **zero workflows matching the governed action printed "nothing to guard" and exited 0**, so renaming or wrapping the action retires the guard silently                                                           | falsified | yes       |
| F4  | `scripts/harness/scan-no-fallback.mjs`                                       | absent `packages/` ⇒ `no-fallback scan passed.`; separately, the `root` parameter was decorative — the walker always walked `WORKSPACE_ROOT`                                                                                 | falsified | yes       |
| F5  | `scripts/harness/scan-no-fake-in-src.mjs`                                    | absent `packages/` ⇒ zero findings ⇒ pass                                                                                                                                                                                    | falsified | yes       |
| F6  | `scripts/harness/check-patch-coverage.mjs:388`                               | **any** `--detect` error (most reachably an unresolvable base ref) wrote `affected=false` to `$GITHUB_OUTPUT` and exited 0, so ci.yml skipped collection and published a green patch-coverage result over an unmeasured diff | falsified | yes       |
| F7  | `packages/agent-core/src/agents/robota.test.ts:503`                          | `expect(true).toBe(true)` under the title "should handle multiple destroy calls safely"                                                                                                                                      | falsified | yes       |
| F8  | `packages/agent-provider-openai/src/openai/executor-integration.test.ts:140` | `expect(true).toBe(true)` under "should clean up executor when provider is disposed" — a claim `OpenAIProvider.dispose()` does not make; it is empty                                                                         | falsified | yes       |

F6's falsification: `PATCH_COVERAGE_BASE_REF=origin/no-such-branch-xyz node scripts/harness/check-patch-coverage.mjs --detect`
wrote `affected=false` / `packages=` and exited 0. After the fix the same command exits 1 and writes nothing.

F7's repair was itself red-proofed: deleting the `if (this.destroyed) return { errors: [] }` guard
from `packages/agent-core/src/core/robota.ts` makes the repaired test fail
(`expected "dispose" to be called 1 times, but got 2 times`). The source was restored.

### Found, NOT fixed — recorded with the reason

**Harness scans that report a pass over an absent governed tree — 30 of them**, every one
`falsified` by executing its finder against a root without its tree. They are not listed here,
deliberately: they live in `PENDING_CLASSIFICATION` in
`scripts/harness/scan-guard-scope-fail-closed.mjs`, where each recorded verdict is **re-executed on
every scan run** (rule 3) and a stale entry is a hard failure. A prose list here would be a second
copy going stale the moment one is fixed — which is the mistake this very paragraph made in its
first draft, naming nine and then being wrong within the hour. Not fixed here to keep the diff
reviewable; each needs its governed root named accurately.

**`check-design-doc-completeness` has never validated a document** (`falsified`: `ls -d
packages/*/docs/design` matches nothing; the scan prints `design-doc completeness scan passed.` and
has done so since it was written). Fixing it is a policy decision — either design docs become
required somewhere, or the scan declares its subject optional — not a mechanical repair.

**Scans that read `packages/` at depth 1 and never see the 21 `packages/dag-nodes/*` members.**
Two of these were falsified and fixed in this item (`check-publish-safety`, `scan-no-fake-in-src` —
see G1 and G5 below); the rest are enumerated with their contradicted claims in the second-axis
section. `scripts/harness/workspace-packages.mjs` already solves this and is now used by eight
scans. Note `check-nested-package-glob-coverage.mjs` exists to catch exactly this shape for CI globs
and does not cover the harness's own enumerations.

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
drop the check when the script is _absent_, whereas `needsTypecheck` pushes unconditionally. So a PR
confined to `packages/agent-cli-web` (no `test` script) means root `pnpm test` never runs at all, and
a PR confined to any of the 16 packages without a `lint` script means root `pnpm lint` never runs.
`hypothesis` — the code path is read, not executed. Not fixed here: the fix changes what CI runs on
real PRs and deserves its own item.

**`packages/dag-builder` has 565 lines of production logic and zero test files**, behind
`vitest run --passWithNoTests`. It is the only one of the 70 `--passWithNoTests` packages where the
flag is load-bearing, and it is imported by 19+ modules. Product change — filed, not made.

**`packages/agent-cli-web/package.json:12` defines `test:e2e` that nothing invokes**, and the package
has no `test` script, so root `pnpm test` skips it entirely.

**`verify-like-ci` runs its `typecheck` stage before its `build` stage, and the workspace typecheck
includes `examples/*`, which resolve `@robota-sdk/*` to `dist`** (`falsified`: on an unbuilt tree the
stage fails with `TS7016: Could not find a declaration file`, and the same `pnpm -w typecheck` exits
0 once `build` has run). The stage order is deliberate — cheap stages first — but this one is not
cheap-and-independent as assumed. It is a false **RED**, the opposite direction from everything else
in this item and therefore far less dangerous: it costs a confusing run, not a missed defect. Worth
fixing so the mirror's verdict means what it says; the fix is either to order `typecheck` after
`build` or to exclude the dist-dependent example projects from the pre-build stage.

**`.claude/hooks/check-forbidden-patterns.sh` is inert for worktree agents** (`falsified`). Its scope
filter is `case "$FILE_PATH" in "$PROJECT_DIR"/packages/*/src/*.ts)`, and `PROJECT_DIR` is
`${CLAUDE_PROJECT_DIR:-.}`. Measured: a payload writing a `catch { return null; }` into
`<repo>/packages/agent-core/src/probe.ts` exits **2** (blocked), the identical payload under
`<repo>/.claude/worktrees/<agent>/packages/...` exits **0**, and with `CLAUDE_PROJECT_DIR` unset the
hook exits 0 for _every_ write. This repo's own orchestration policy puts agent work in
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
  `if:`, and R4 requires _every_ step to be conditional. `ci.yml:431` (`dependency audit`, required)
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
token _appears_ rather than that a seam is _wired_. Not duplicated here.

### Fixed in this item

| #   | Location                                                                       | Sub-shape | Verdict   |
| --- | ------------------------------------------------------------------------------ | --------- | --------- |
| G1  | `scripts/harness/check-publish-safety.mjs:91`                                  | A + C     | falsified |
| G2  | `scripts/harness/scan-dist-freshness.mjs:1`                                    | A         | falsified |
| G3  | `scripts/harness/scan-guard-scope-fail-closed.mjs` (×3, this item's own guard) | A         | falsified |
| G4  | `scripts/harness/scan-conflict-markers.mjs`                                    | A         | falsified |
| G5  | `scripts/harness/scan-no-fake-in-src.mjs:159`                                  | C         | falsified |
| G6  | `apps/agent-server/src/__tests__/websocket-server.test.ts` (×2)                | A         | falsified |
| G7  | `packages/agent-framework/src/__tests__/no-insecure-temp-path.test.ts:36`      | A         | falsified |

**G3 — the guard this item shipped committed the audited defect, three times.** An independent
sweep of this branch's own work found it; all three were then falsified.
(a) The derivation regex was `export function (find…)\(\s*root\s*=`, so it derived **20 of 50**
finders — it saw neither `export async function`, nor a `collect…` finder, nor a `root` without a
default — and therefore did not classify **itself**, `findGuardScopeFindings` being async.
Falsified by registering a scan exporting an unconditionally vacuous
`export async function findBogusFindings(root = X)`: the completeness rule, whose stated claim is
"a new scan cannot be added without answering for its behaviour", passed. Flipping the single
keyword `async function` → `function` made the same file fail — proof the rule was measuring
spelling, not structure. (b) `finder(bare)` was not awaited, so a _classified_ async finder would
have been reported as violating no matter how it behaved; the two defects masked each other exactly.
(c) The regex matched the example declaration written in the file's own docstring and derived a
finder for a function that does not exist — a scan reading its documentation as evidence.
The ledger is now regenerated by **executing** all 50 finders against a bare root: 30 vacuous,
20 fail-closed. This is the strongest single result of the sweep, and it is an argument for the
method: the guard was reviewed, tested, and green, and only falsification found it.

**G4 — a `conflict-markers` gate that does not check for conflict markers.** It checked only for
contradictory _guidance_ in three markdown trees. Falsified: a literal `<<<<<<< HEAD` / `=======` /
`>>>>>>> develop` block appended to `packages/agent-core/src/index.ts` left it printing
`conflict marker scan passed.`, and no other harness scan detects the pattern. A `✓ conflict-markers`
line in the merge-gate summary was evidence for a check nobody performed. The missing rule was added
rather than the scan renamed, so the name people read as merge evidence becomes true.

**G5 — the scan G3's guard certifies as covering `packages/`, covering 55 of 76 of it.** It walked
`packages/` at depth 1, so `packages/dag-nodes` (which has no `src/` of its own) was skipped along
with all 21 members and their 59 source files. The first pass of this item hardened the same
function against a _missing_ tree while leaving its _enumeration_ one level deep — and then pinned
it as a mandatory guard, certifying coverage it did not have. Falsified with
`export class MockToolClient {}` in `packages/dag-nodes/tool/src/index.ts`: `no-fake-in-src scan
passed.` Now nesting-aware via the SSOT enumerator.

**G6 — two `agent-server` regression guards that did not observe their contract.** The SEC-001 guard
(`empty token must be rejected`) names `client.ws.close` in its title and asserted only that _some_
error frame arrived — satisfied by the unrelated `Invalid auth payload` branch. Reintroducing the
hole _did_ turn it red, but via `httpServer.close()` hanging on the still-open socket until vitest's
5s timeout: an accidental red reading `Test timed out in 5000ms`, which a raised `testTimeout` or a
forced teardown would have retired silently. The SRV-002 guard spied the **global** `clearInterval`
and asserted only `toHaveBeenCalled()`; `clearInterval(setInterval(() => {}, 1e9))` restores the
timer leak in full and it passed. Both now assert the named contract.

**G7 — a security floor whose detector could not span a line break.** The SEC-003 CWE-377 rule ran
inside `lines.forEach`, so its `\s*` could never cross a newline and it only fired when `join(` and
`tmpdir()` landed on the same physical line — which Prettier's 100-column wrap routinely prevents.
Falsified with a verbatim wrapped `join(\n tmpdir(),\n 'robota-cache.json',\n)`. Widening it to the
whole source then flagged three _safe_ `mkdtempSync(path.join(tmpdir(), …))` call sites, so the
lookbehind had to admit a module qualifier — an over-firing floor is one that gets suppressed, which
is sub-shape B arriving as the cost of fixing sub-shape A.

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
dist/". The behaviour is a correct presence gate; the _name_ is the defect. Not renamed here — the
registered name `dist` appears in a `--skip dist` argument inside `ci.yml`, which is outside this
item's ownership — so the docstring now states the gap explicitly instead of implying the check.
`verify-like-ci` already compensates: its `build` stage exists because "locally a STALE dist passes
the presence-only freshness scan", and it rebuilds rather than trusting this result.

### Guarded

`scripts/harness/workspace-packages.mjs` is the SSOT every nesting-aware scan enumerates through, so
each scan's coverage is exactly as correct as that module's — and its rule is a _heuristic_ (recurse
one level into a depth-1 directory that is not itself a package), not a reading of
`pnpm-workspace.yaml`. The two could drift apart silently, which is how G1 happened.
`scripts/harness/__tests__/workspace-packages.test.mjs` now pins them together, deriving the expected
set from the manifest rather than from the same recursion under test. Red-proofed: removing the
nested recursion fails 3 of 5 cases and names all 20 dropped packages. The one-level recursion
ceiling is asserted too, so it is a known boundary rather than a surprise.

### Recorded, not fixed

All `hypothesis` unless marked otherwise — read from source, not executed.

> **Second pass, 2026-07-27.** Everything in this section down to "Narrower" has since been FIXED and
> falsified, except where the Acceptance list still says otherwise: the seven depth-1 walkers, all
> four presence-of-a-string guards, the `scan-test-plan` tree, `scan-file-size`'s ratchet, both
> `agent-provider-bytedance` allowlist entries, `check-design-doc-completeness`' subject, and 27 of
> the 31 vacuous finders. The prose below is left as the AUDIT RECORD — what was measured, when — and
> the Acceptance list is the current state. Where the two disagree, the Acceptance list wins; the
> live state is the ledger in `scan-guard-scope-fail-closed.mjs`, which re-measures on every run and
> cannot go stale the way a second prose copy would. Still open here and NOT fixed:
> `check-build-output-contracts:191`'s decorative `root`, `scan-dist-freshness:59`'s operator
> precedence, `check-temp-script-placement`'s filename globs, `check-harness-config-paths`' quoted-path
> scope, the four test findings, and every workflow hypothesis.

**Depth-1 `packages/` walkers (sub-shape C), the canonical drift.** Each enumerates `packages/` at
depth 1 while `pnpm-workspace.yaml` declares `packages/dag-nodes/*` (21 members, 59 source files),
and each states a universal claim: `check-orphan-exports:75` ("referenced nowhere else **in the
workspace**" — the nested members are excluded from the reference corpus too, so their imports
cannot rescue a symbol elsewhere either), `check-interface-imports:104` ("scans **every**
implementation-package `src`", summary `scanned=2080`), `check-dep-kind:99` ("**scan every workspace
package**"), `check-dependency-direction:394` ("**every** `packages/<name>/docs/SPEC.md`" — 21 SPEC
files unchecked, and the asymmetry is _within one file_: its own `findWorkspacePackages` is
nesting-aware), `check-doc-examples:41` ("**each** `packages/x/README.md`"),
`check-design-doc-completeness`, `scan-memory-neutrality`. `workspace-packages.mjs` exists for
exactly this and eight scans now use it.

**Presence-of-a-string standing in for a structural property — the `agent-server-boundary` family
(sub-shape A).** `check-test-coverage-scripts:78` asserts "wired into `harness:scan`" with
`readFileSync(run-all-scans.mjs).includes('check-test-coverage-scripts.mjs')`, which stays true when
the registration is _commented out_. `scan-orchestration-map:43` proves "listed in the Orchestration
Map" with `mapText.includes(name)` — satisfied by the bare name appearing in prose, in a fenced
block, or as a substring of another agent's name. `check-functional-coverage:77` claims "**every**
framework capability … drives a REAL InteractiveSession" but reads a self-referential 11-row manifest
and accepts the token `scriptedSession` appearing anywhere, including a comment beside a
`describe.skip` — the precise case its docstring forbids. `scan-deployment-matrix:74` says its
subject is "adapters that declare a `name`" and actually matches a directory prefix plus a filename
substring, so the base `packages/agent-transport` can never contribute.

**Criteria that drifted (sub-shape C).** `scan-test-plan:20` gates
`docs/superpowers/**` + `.agents/tasks` (35 files) while the live pipeline `.agents/spec-docs/**`
holds **242** unscanned — and `check-ghost-package-refs:68` classifies that same tree as "dated
historical artifacts", so one guard treats as live what another treats as history.
`check-command-layering:280` filters on `agent-command-`, whose trailing hyphen excludes
`packages/agent-command` — the base command package — from both the sweep and the import regex.
`check-ghost-package-refs:54` and `check-workspace-refs:30` both allowlist
`@robota-sdk/agent-provider-bytedance` as "not a workspace package"; it is one, and its cited backlog
item is already in `completed/`. `scan-agent-tools-neutrality:72` tells the fixer to add to an
`ALLOWLIST` in a file that no longer holds one (HARNESS-DIET-002 moved it to
`.agents/harness.config.json`).

**Narrower.** `check-build-output-contracts:191` passes `root` to `listWorkspaceScopes()`, which
takes **no parameters** and closes over `process.cwd()` — the same decorative-`root` defect this item
fixed in `scan-no-fallback`. `scan-dist-freshness:59` has an operator-precedence bug that downgrades
a genuine missing-dist error to a non-blocking warning for any package with `main` pointing at
`dist/` but no `exports` block, under a banner claiming "All N buildable packages have dist/".
`scan-file-size` emits **21** `[ratchet-tighten]` notices and exits 0, so the "regenerate in the same
PR" discipline is unenforced and 21 files are licensed to regain every line they shed — a ratchet
that has loosened, plus 21 advisory lines per run (sub-shape B).
`check-temp-script-placement:22` enforces three filename globs harvested from one incident under a
_placement_-rule name. `check-harness-config-paths:34` only validates quoted paths starting
`packages|apps|scripts`, so the many `.agents/**`, `.github/**` and `content/**` literals across the
harness are unguarded by the one meta-guard for that class.

**Tests (sub-shape A), from an independent sweep of all 903 test files.**
`packages/dag-nodes-default/src/index.test.ts:50,57,66,75` — four tests named for `tryImport`/
`tryConstruct` catch branches, none of which arranges a failure; all four call the identical happy
path, and line 75 creates a `console.warn` spy it never asserts on. Removing both `try`/`catch`
blocks leaves all four green. `apps/dag-runtime-server/src/__tests__/app.contract.test.ts:26,33` —
"returns a successful response" asserts `status < 500` (admitting 404) and `toBeDefined()` on a
parsed body that can never be `undefined`; deleting the route registration leaves it green.
`apps/action/__tests__/command-injection.test.ts:29` spawns a hardcoded `echo` instead of
`invocation.file`, so it proves `execFileSync`'s no-shell semantics rather than the SUT's — its two
sibling tests are sound. `packages/agent-transport-webrtc/.../cve-2024-29415-reachability.test.ts:44`
swallows a `require.resolve` failure for `werift-ice`, the package its header names as the one
reaching the vulnerable code, and asserts only `dirs.length > 0`, which the other package satisfies.

**Category B produced no confirmed finding in tests**: `toMatchSnapshot`/`toMatchInlineSnapshot`
appear zero times across `packages/` and `apps/`, and deep-equals over volatile data correctly use
`expect.stringMatching`. Bare `toThrow()` appears in only five places and none of those titles names
a message or code.

## The mechanical ceiling

Stated rather than implied, because an audit claiming completeness it cannot have is itself the defect:

- **A weak assertion is not detectable by pattern.** `scan-tautological-assertions` catches only
  assertions that are _structurally_ incapable of failing. Several tests found in this sweep assert a
  run reached `status: 'success'` while never checking the value the run was supposed to produce
  (`packages/dag-framework/src/__tests__/create-dag-framework.test.ts:46,79` — a DAG configured with
  `prefix: 'hello '` over input `'world'` where `'hello world'` appears in no assertion). Only
  mutation testing reaches those.
- **A scan whose logic is subtly wrong still passes.** `scan-guard-scope-fail-closed` asserts a
  guard fails closed when its governed tree is _absent_; it says nothing about whether the guard's
  rules are correct when the tree is present.
- **Scans that walk their tree inline in `main()`, or take no root parameter, are outside the new
  guard's derived set.** It covers 20 of ~70 registered scans, by construction, and says so in its
  output.
- **GitHub-side behaviour cannot be falsified locally.** Every workflow finding above is a hypothesis.
- **A name/behaviour mismatch is not mechanically detectable at all.** The second axis was audited by
  reading, and only two of its findings were falsified. No scan can decide whether a check's name
  describes what it measures — that is a judgement about intent. G1 was found because its message
  contained the word "all"; a check whose name is merely _optimistic_ leaves no such token.
- **Over-checking (sub-shape B) produced one confirmed finding** — `scan-file-size`'s 21 advisory
  lines per run — and it was found by reading, not by measurement. "Noisy enough that people route
  around it" is a property of behaviour over time; nothing here measures it. Fixing G7 also _created_
  a B-shaped risk (three false positives) that had to be corrected before it shipped, which is the
  general hazard of tightening an A-shaped rule.
- **Whether a dispatched agent published what it found is outside any mechanism we can write.**
  `pr-finding-resolution-loop` step 5 dispatches `pr-review-writer` to post and then `pr-review-fixer`
  to fix; measured at `24f803bff`, nothing enforces the first half — the two files under
  `scripts/harness/` that name the writer are a doc comment and an _exemption_ entry. **The
  consequence is not an unmerged pull request**: the merge gate wants a published verdict from the CI
  reviewer and never wanted this one. The consequence is that findings vanish. What bounds any fix is
  observability — a hook sees a `gh` invocation, so it can tell that something _was_ posted; it cannot
  see a subagent that returned findings into a context and stopped, so it cannot tell that something
  was _not_. **The enforceable property is therefore about the artifact, never about the dispatch.**
  Recorded here rather than as its own item: it is an instance of this sweep's class, not a new one.
  `scan-review-findings.mjs` is **not** an example of the failure — its header scopes itself to
  contract presence explicitly, and `orchestration-map.md` footnote § records it as a partial floor
  rather than counting it as satisfied. A check that declares what it does not cover, and a map that
  refuses to count it as coverage, is the shape this sweep is trying to produce.
  - **And there is already a ledger for it, which is not being written.**
    `.agents/loop-runs/pr-finding-resolution-loop.jsonl` exists to record finding-resolution rounds
    and carries a `ref` column pointing back at the pull request. Measured at `69496794d`: it holds
    ten rows, and **PR #2323 has none — while that pull request received nine `ACTIONABLE FINDINGS`
    verdicts, all nine reporting zero.** Nine rounds ran and the ledger that exists to record them
    recorded nothing.

    That narrows the bullet above rather than contradicting it. A hook still cannot see a subagent
    returning findings into a context — but it **can** see whether a row was appended for a pull
    request whose rounds are visible in its own comment history. **The enforceable property is about
    the artifact, and the artifact is already specified; what is missing is that it is written.** A
    mechanism here would guard an existing ledger's completeness, not invent a new observation point.

    Deliberately not carried: the ledger also has four rows with an empty `ref`, but an empty `ref`
    cannot be told from a row that never could carry one, so that count says nothing until the two
    are distinguished. The row-count-versus-round-count comparison above is the only signal here that
    is unambiguous, and it is the only one recorded.

  - The case that prompted this — a loop reported as running many reviewer dispatches and no writer
    dispatch, losing two real findings — **is not recorded anywhere in this repository**; it reached
    this record through a session message and its counts are not reproducible from any artifact here.
    They are therefore omitted rather than restated. That is not a footnote to the instance: **the
    evidence that findings vanish when they stay in a session survives only in a session**, which is
    the same defect one level up, and it is why the structural claim above is stated from what the
    tree shows instead.
- **The single most useful result of this sweep was a defect in the sweep's own guard** (G3), found
  by an independent reader after the guard was written, tested, reviewed and green. That is the
  honest summary of the ceiling: the method that works is adversarial falsification by someone other
  than the author, and neither this document nor any scan in it can promise it was applied
  everywhere. Two of the three G3 defects masked each other, so even a partial falsification would
  have reported the guard as sound.

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
- [x] `scan-conflict-markers` detects literal git conflict debris, so its registered name is true.
- [x] `scan-no-fake-in-src` covers the nested package group its guard-scope pin certifies.
- [x] The guard-scope scan derives async and `collect…` finders, awaits them, and ignores its own
      docstring — and its ledger is regenerated by executing all 50, not by reading them.
- [x] All seven depth-1 `packages/` walkers adopt `workspace-packages.mjs` — `check-orphan-exports`,
      `check-interface-imports` (scanned 2080 → 2139), `check-dep-kind`, `check-dependency-direction`,
      `check-doc-examples`, `check-design-doc-completeness`, `scan-memory-neutrality`. Red-proofed as
      ONE mutation: restoring the depth-1 walk inside the SSOT fails all seven cases in
      `__tests__/nested-package-enumeration.test.mjs`. Surfaced one genuine orphan in a nested member
      (`packages/dag-nodes/llm-text/src/config.ts:ProviderEntrySchema`), file-scope-baselined because
      its one-keyword repair is in `packages/**`.
- [x] The four `presence-of-a-string` guards assert the structural property they name.
      `check-test-coverage-scripts` reads the runner's exported `SCAN_COMMANDS` (falsified: with the
      registration commented out the substring is still present TWICE and the old check stayed green);
      `scan-orchestration-map` requires a registry ROW, not a mention in prose, in a mermaid diagram,
      or as a substring of another agent's name; `check-functional-coverage` strips comments, requires
      the marker in CALL position, and fails a file whose every case is skipped; `scan-deployment-matrix`
      stops filtering on the `agent-transport-` directory prefix and so can finally see `headless`,
      declared in the BASE package — the matrix had been asserting a complete set certified by a check
      structurally unable to read one of its members.
- [x] `scan-test-plan` gates the LIVE spec-doc pipeline (`backlog/`, `todo/`, `active/`) rather than
      the archived tree. NOT all 242 files: measured, `draft/` (pre-GATE-WRITE, incomplete by design)
      would fail 1 of 3 and `done/`+`rejected/` would fail 6 of 237 immutable records. Also fails
      closed on an absent `.agents/spec-docs`, and reports the count it checked.
- [x] `scan-file-size`'s ratchet-tighten notice becomes a failure, as `check-test-module-mocks` does.
      Red then green on the real path: 21 findings, then `--write-baseline` (102 → 95 entries; seven
      files burned below the limit entirely, fourteen tightened) and exit 0.
- [x] The two stale `agent-provider-bytedance` allowlist entries are removed. Falsified before
      removal: a doc referencing that token in a workspace WITHOUT the package returned ZERO findings.
      Both scans now report a RESOLVING allowlist entry as a `stale-allowlist-entry` finding.
- [x] 27 of the 31 vacuous finders in `PENDING_CLASSIFICATION` fail closed via a shared
      `requireGovernedTree`, re-measured every run; guards proven fail-closed BY EXECUTION 15 → 43.
      The four that remain are recorded reasons rather than debt: `findVitestConfigs` and
      `findUsedExemptions` are pure enumerators whose caller renders the verdict,
      `collectInstalledCopies` governs `node_modules` (not checked in — requiring it would fail on a
      correct tree), and `findTestSelectionFindings` is owned by INFRA-060.
- [x] `check-design-doc-completeness`' subject is DECIDED: optional (the decision the scan was built
      with, and what `design-doc-authoring` already states). It has never validated a document, so a
      zero-document run now raises an advisory through HARNESS-053's channel and the pass line reports
      the count examined, instead of rendering as an ordinary tick.
- [x] `run-all-scans` has a third output channel: a scan may mark a line and have it surfaced even
      on exit 0, so a finding made by a passing scan is no longer discarded. Landed in HARNESS-053
      (#1491).
- [ ] `run-all-scans` distinguishes "ran and found nothing" from "ran and measured nothing" — the
      channel above exists, but nothing routes a SKIP through it: a scan that examined no subject
      still renders `✓` and still counts toward `all N scans passed`. Owned by `HARNESS-056`.
- [ ] `review-gate.yml` subscribes to `edited`; R7 is extended to `develop`'s required contexts.
- [ ] `changes` is a required context, or the three jobs it gates stop depending on it.
- [ ] `.claude/hooks/check-forbidden-patterns.sh` resolves worktree paths.
- [ ] `packages/dag-builder` has tests; `--passWithNoTests` is removed where it is load-bearing.
- [ ] **G8 (sub-shape A) — `check-spec-whitebox-leakage` measures heading conformance, not placement.**
      `scripts/harness/check-spec-whitebox-leakage.mjs:62` marks a span only on `/^##\s+/`, so every
      `###` is attributed to its enclosing `##`. Demoting a non-standard `##` to `###` under a standard
      one drives the reported residual to **zero with no content moved**. Observed live: RULE-013 WU-B
      demoted 20 non-standard `##` in `packages/agent-cli/docs/SPEC.md` and the scan went from
      1,708/1,939 (88.1%) to 0/1,731 (0.0%) — the 1,731 is the round-2 reading; later folds took the file to 1,744, and the residual stayed 0. The scan's name promises "whitebox leakage"; what it
      measures is whether headings match a list. Filed by RULE-013, which routed around it — TC-05 now
      asserts destination volume plus `verify-doc-split-preservation.mjs`, and TC-06 (which the
      demotion _satisfies_) was demoted to an observation. Fix is either deep-level attribution or a
      rename that stops the metric claiming placement.

## References

- `.agents/tasks/completed/HARNESS-051-dead-code-satisfies-architecture-gate.md` — records the same class
  from SEC-005's angle: the vacuously-satisfied `agent-server-boundary` gate, the test-file
  `no-unused-vars` exemption that hid the assertion-free tests, and `verify-change.mjs`'s `passed`
  field that is structurally always `true`. Not duplicated here.
- INFRA-048, INFRA-050, INFRA-055, INFRA-056, INFRA-057, HARNESS-041, HARNESS-050 — the ten instances.
