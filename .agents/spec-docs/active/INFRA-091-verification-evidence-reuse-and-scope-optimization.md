---
status: in-progress
type: INFRA
tags: [cli, typescript]
---

# INFRA-091: Verification Evidence Reuse and Scope Optimization

## Problem

Robota's written verification policy requires proportional local checks and explicitly forbids
repeating a weaker gate after a stronger gate has passed for the same final diff. The executable
pipeline contradicts that contract in five reproducible ways:

1. `pnpm harness:verify-like-ci` runs the 174-file / 3,188-test harness suite in its
   `harness-self-test` stage and then `affected-verify` runs it again when a harness path changed.
2. `pnpm harness:pre-push` runs `harness:verify`, which can run the harness suite, and then runs the
   required `scans` mirror, which runs the same suite again. It also cannot reuse a just-passed
   CI-equivalent result for the same clean commit, so the measured successful 16-minute gate began
   again at push time.
3. Any root `package.json` change is an unconditional workspace-wide trigger. Adding only the
   developer commands `lint:fix` / `lint:fix:staged` therefore selected 86 of 86 product scopes,
   even though package-scoped manifests already receive semantic before/after classification.
4. The `changes` output has only a `code` boolean. A harness-only change therefore launches product
   TUI, examples, and Windows runtime jobs. On a measured harness-only PR, the TUI job was the
   five-minute critical path.
5. Full-scope affected verification starts package test, lint, and typecheck commands in one serial
   loop. The measured 86-scope tail took about 5 minutes 14 seconds. The TUI PTY suite also repeats
   all 27 terminal/override capability cells across real binary startups even though the exhaustive
   logical matrix already has a unit-test owner; those cells consumed 70.8 of 94 seconds.

The fixed cost statement in `.agents/rules/git-branch.md` (“roughly 3.5-5 minutes” for any code
branch) is consequently stale and conceals which retained check owns the elapsed time.

## Prior Art Research

Research date: 2026-08-13. Official GitHub Actions, Git, pnpm, npm, and Vitest documentation was
cross-checked against the live Robota pipeline and the measured run above.

- GitHub warns that required checks must continue to report a conclusion; path-filtering or an
  upstream failure must not silently turn a required gate into an accepted skip. The safe shape is
  to keep stable required jobs, give each substantive check one owner, and explicitly report
  non-applicability inside the job. See
  [required-check troubleshooting](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks),
  [workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow),
  and [job dependencies](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs).
- Git provides exact commit/tree identities, diff equality, and the exact pushed local object on
  pre-push stdin. Correctness evidence can therefore use an exact-match receipt rather than a
  heuristic cache. See [git-rev-parse](https://git-scm.com/docs/git-rev-parse),
  [git-diff](https://git-scm.com/docs/git-diff), and
  [githooks](https://git-scm.com/docs/githooks). GitHub's cache guidance likewise reserves partial
  restore keys for performance artifacts, not proof of a passed gate:
  [dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).
- npm documents `scripts`, dependency fields, overrides, and engines as different manifest
  contracts. Root manifest planning should parse semantics and fail full on unknowns rather than
  equating an allowlisted developer-only script with a dependency/build contract change. See
  [npm package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).
- Vitest supports bounded workers and file sharding, while pnpm recursive execution supports
  bounded workspace concurrency, aggregate output, non-bailing result collection, and summaries.
  See [Vitest parallelism](https://v4.vitest.dev/guide/parallelism),
  [Vitest performance](https://main.vitest.dev/guide/improving-performance),
  [pnpm filtering](https://pnpm.io/filtering), and
  [pnpm recursive execution](https://pnpm.io/cli/recursive).

Robota has a recorded 23 GB recursive-worker exhaustion and intentionally caps Vitest concurrency.
Therefore unbounded parallelism is rejected. The selected approach removes semantic duplication,
uses exact evidence identity, retains fail-closed classifiers, keeps exhaustive capability logic in
unit tests, and batches package-owned scripts through a bounded scheduler.

## Architecture Review

### Affected Scope

- Verification policy owners:
  - `.agents/rules/verification.md`
  - `.agents/rules/git-branch.md`
  - `.agents/specs/verification-pipeline-plan.md`
- Harness planning/execution:
  - `scripts/harness/check-plan.mjs`
  - `scripts/harness/shared.mjs`
  - `scripts/harness/plan-change.mjs`
  - `scripts/harness/verify-change.mjs`
  - `scripts/harness/verify-like-ci.mjs`
  - `scripts/harness/pre-push.mjs`
  - a harness-owned verification-receipt module under `scripts/harness/`
- CI applicability and ownership:
  - `scripts/harness/classify-changed-paths.mjs`
  - `.github/workflows/ci.yml`
  - `scripts/harness/ci-mirror-map.mjs` if step mapping changes
- TUI verification strategy:
  - `packages/agent-transport-tui/docs/SPEC.md`
  - `packages/agent-transport-tui/src/__tests__/pty/ime-cursor.ptytest.ts`
  - existing exhaustive `terminal-capabilities.test.ts` remains the matrix owner
- Focused harness and TUI tests covering every changed contract.

### Alternatives Considered

1. **Keep all duplicate gates and only increase Vitest/pnpm concurrency.**
   - Pro: Minimal policy change.
   - Con: Preserves duplicate work, ignores exact prior evidence, and can recreate the recorded OOM.
2. **Skip broad checks by coarse path filters or treat every scripts-only manifest change as narrow.**
   - Pro: Largest apparent time reduction with little implementation.
   - Con: Can remove required conclusions and fails open for build/test/lifecycle or unknown script changes.
3. **Single ownership + exact receipt + fail-closed semantic classification + bounded batching.**
   - Pro: Removes measured duplication while retaining all required conclusions, package-owned commands,
     unknown-to-full behavior, and the existing resource ceiling.
   - Con: Requires coordinated harness, workflow, policy, and regression-test updates.

### Decision

Choose alternative 3.

- `scans` / `harness-self-test` remains the single owner of the full harness suite. Callers that
  already have that evidence omit only the named `harness-tests` repository check; standalone
  `harness:verify` retains it.
- A full CI-equivalent run writes a receipt only after all selected required stages pass on a clean
  tree. Identity includes the pushed commit/tree, resolved base commit, profile/stage set, Node/pnpm
  versions, lockfile hash, and a fingerprint of verification-owner files. The receipt lives under
  Git's common directory, is atomically written under the repository lock, and is exact-match only.
  Missing, malformed, stale, partial, dirty, different-base, different-pushed-object, or weaker
  receipts are misses that run the existing verification path.
- Root `package.json` uses a before/after classifier. Only changes confined to the explicitly
  allowlisted developer scripts `lint:fix` and `lint:fix:staged` are narrow. Dependencies,
  overrides, engines, lifecycle/build/test/typecheck/lint/verification scripts, mixed deltas, parse
  failures, and unknown fields remain workspace-wide.
- CI classification exposes separate applicability capabilities (`code`, `product`, `tui`,
  `examples`, and dependency relevance as needed). Unknown/error conditions set every safety-relevant
  capability true. Required jobs remain present and emit an explicit successful non-applicable
  conclusion instead of disappearing.
- The 27-cell terminal capability table remains exhaustive in the unit test. Real PTY coverage keeps
  supported-default, Terminal.app-default-off, Terminal.app-force-on, and supported-force-off
  boundary cases, both viewport geometries for enabled positioning, and the real tmux suite.
- Full-workspace package checks preserve each package's script and use bounded pnpm recursive/filter
  batching with aggregate failure evidence. No global worker ceiling is raised.
- Every `verify-like-ci` stage records elapsed time in the summary so future optimization is based on
  observed owners rather than a stale fixed duration claim.

Validation before approval:

- Reachability: all callers of `createVerificationPlan`, `harness:verify`, `verify-like-ci`, and
  `pre-push`, plus the CI `changes`, `quality`, `examples-typecheck`, `windows-shell`, and `tui-e2e`
  consumers were inspected.
- Capability preservation: standalone verification still owns repository checks; required CI jobs
  keep a conclusion; package-specific scripts remain authoritative; exhaustive terminal capability
  coverage remains in its existing unit-test owner.
- Adversarial pass: unresolved refs, missing/malformed receipts, dirty trees, multi-ref pushes,
  changed base refs, manifest parse failures, mixed/unknown manifest deltas, classifier failure,
  missing aggregate package results, and partial `--only` runs all take the full/miss/fail path.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — local verify, pre-push, develop CI, release gate, TUI PTY callers 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Add selective repository-check omission to `harness:verify`, rejecting unknown check names.
   `verify-like-ci` and CI quality omit `harness-tests` only where the required scans owner remains;
   pre-push runs the scans mirror once and omits the duplicate inside affected verification.
2. Add exact verification receipts and integrate them after clean-tree/lockfile/push-update checks but
   before build prerequisites. A valid stronger receipt reports reuse and suppresses the weaker
   pre-push verification; every invalid identity component runs the normal path.
3. Add root-manifest semantic classification and keep the current unconditional workspace-wide list
   for genuinely global compiler/build/dependency owners.
4. Extend changed-path classification and CI outputs so harness-only code receives harness/quality
   checks without product runtime E2E. Required jobs explicitly conclude non-applicability; classifier
   failures still run all safety-relevant work.
5. Replace repeated PTY capability enumeration with four representative boundary cases while
   retaining exhaustive unit and real tmux coverage.
6. Add a full-plan bounded aggregate executor that invokes package-owned scripts, proves every
   planned scope/check produced a result, and reports failures per scope. Keep the existing serial
   path for narrow plans until measurement supports changing it.
7. Add stage timing and total timing to local summaries and CI job summaries. Replace fixed cost
   prose with the measured-output contract.

## Affected Files

- `.agents/rules/verification.md`
- `.agents/rules/git-branch.md`
- `.agents/specs/verification-pipeline-plan.md`
- `packages/agent-transport-tui/docs/SPEC.md`
- `packages/agent-transport-tui/src/__tests__/pty/ime-cursor.ptytest.ts`
- `.github/workflows/ci.yml`
- `scripts/harness/{check-plan,shared,plan-change,verify-change,verify-like-ci,pre-push,classify-changed-paths,ci-mirror-map}.mjs`
- `scripts/harness/verification-receipt.mjs` (new internal harness primitive)
- focused tests under `scripts/harness/__tests__/`

## Completion Criteria

- [ ] TC-01: A harness-change fixture causes one full harness-suite invocation in each of
      `verify-like-ci`, pre-push, and develop CI ownership graphs; an unknown selective-skip name exits non-zero.
- [ ] TC-02: A full clean-tree CI-equivalent PASS creates an exact receipt; unchanged same-object/base/tool
      pre-push reports receipt reuse, while dirty, partial, malformed, stale-base, stale-tool, weaker-profile,
      and different-pushed-object fixtures all run verification.
- [ ] TC-03: Root manifest fixtures changing only `lint:fix` / `lint:fix:staged` select 0 product scopes;
      dependency, override, engine, build/test/typecheck/lint/lifecycle, mixed, parse-error, and unknown changes
      select all configured scopes.
- [ ] TC-04: Harness-only CI fixtures set `code=true` and product/TUI/examples runtime applicability false;
      required jobs still conclude success through an explicit non-applicable step, while classifier failure
      runs every safety-relevant job.
- [ ] TC-05: The TUI unit suite still executes all terminal/override capability cells and the PTY suite
      executes the four representative boundary cells plus wide/narrow positioning and real-tmux coverage;
      `pnpm --filter @robota-sdk/agent-transport-tui test:pty` exits 0.
- [ ] TC-06: A synthetic full-workspace plan executes each planned package-owned test/lint/typecheck script
      through bounded batching, rejects missing per-scope evidence, aggregates multiple failures, and performs
      fewer command launches than the serial baseline.
- [ ] TC-07: `pnpm harness:verify-like-ci -- --only format-check --only harness-self-test` prints per-stage
      and total elapsed times and does not create a full-gate receipt; a full PASS prints timing and creates one.
- [ ] TC-08: Verification policy and the cross-cutting verification plan describe targeted development,
      one pre-merge full gate, exact receipt invalidation, and measured timing without the stale 3.5-5 minute claim.
- [ ] TC-09: Focused harness tests, `pnpm harness:scan`, TUI unit/PTy tests, and final
      `pnpm harness:verify-like-ci` all exit 0 on the post-fix tree.

## Test Plan

| TC-ID | Test Type                 | Tool / Approach                                                             | Notes                                                         |
| ----- | ------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| TC-01 | CI pipeline unit/contract | Vitest fixtures + workflow ownership parser                                 | Assert one owner, exact selective skip, unknown fail-closed   |
| TC-02 | Integration/unit          | Temporary Git repositories + pre-push injected sequence                     | Covers exact-match receipt and every invalidation edge        |
| TC-03 | Unit                      | Root manifest before/after fixtures in check-plan tests                     | Both narrow allowlist and full fallback directions            |
| TC-04 | CI pipeline contract      | Classifier unit tests + parsed `ci.yml` assertions                          | Required jobs remain present and fail closed                  |
| TC-05 | Unit + process E2E        | TUI unit suite and `test:pty`                                               | Exhaustive logic owner plus representative real boundary      |
| TC-06 | Integration/unit          | Synthetic workspace scripts recording execution/results                     | Bounded batching, missing evidence, multi-failure aggregation |
| TC-07 | CLI integration           | Partial/full verify fixture with temporary receipt store                    | Timing visible; partial never certifies full                  |
| TC-08 | Governance                | `pnpm harness:scan:consistency` + targeted `rg` absence/presence assertions | Owner prose and mechanics agree                               |
| TC-09 | Regression/CI smoke       | Focused Vitest, harness scan, TUI tests, final CI-equivalent gate           | Final post-fix evidence                                       |

## User Execution Test Scenarios

### Scenario 1: Reuse a completed full gate at push

1. On a clean feature commit, run `pnpm harness:verify-like-ci` to completion.
2. Run the real pre-push entry with a fixture update line naming that same local commit.
3. Expected: clean-tree and lockfile checks still run; output names the exact receipt identity and no
   package/harness verification command starts.

### Scenario 2: Narrow developer-script manifest change

1. Generate a plan from a fixture whose only root manifest delta adds or changes
   `lint:fix` / `lint:fix:staged`.
2. Expected: repository quality checks are selected, scope coverage is `0 of 86`, and the output
   explicitly names the semantic narrow classification.
3. Change root `build` in the same fixture.
4. Expected: scope coverage becomes `86 of 86` and names root build tooling as the trigger.

### Scenario 3: Harness-only required CI applicability

1. Run the classifier and workflow-contract fixture for `scripts/harness/example.mjs`.
2. Expected: scans/quality remain applicable; TUI/examples/Windows product work reports explicit
   non-applicability without disappearing.
3. Force classifier failure.
4. Expected: every safety-relevant product applicability output becomes true.

## Tasks

- [x] `.agents/tasks/INFRA-091-verification-evidence-reuse-and-scope-optimization.md` — active implementation record

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-13

**Status upgrade:** draft → review-ready

- Frontmatter block: file begins with YAML frontmatter and declares `status: draft`.
- Frontmatter type: `type: INFRA` is one exact allowed type value.
- Frontmatter tags: `tags: [cli, typescript]` is present.
- Problem symptom: names five concrete contradictions, including duplicate 174-file/3,188-test runs, 86/86 scope expansion, and measured 5m14s/70.8s tails.
- Problem reproduction: identifies the commands, changed-path conditions, root-manifest condition, harness-only PR condition, and full-scope/PTy paths where each symptom occurs.
- Problem quality: contains no `TBD`, `TODO`, or vague single-sentence problem description.
- Prior Art Research presence: `## Prior Art Research` is present and dated 2026-08-13.
- Prior Art Research substantiation: cites official GitHub Actions, Git, npm, Vitest, and pnpm documentation; `node scripts/harness/scan-spec-research.mjs` exited 0 after examining 6 spec documents.
- Research-to-decision trace: the research findings support exact commit/tree receipts, stable required-job conclusions, semantic manifest parsing, bounded workers, and bounded recursive execution used in Alternatives 2/3 and the Decision.
- Architecture checklist: all four checklist items are `[x]`.
- Sibling scan: checked with explicit evidence covering local verify, pre-push, develop CI, release gate, and TUI PTY callers.
- Alternatives: three alternatives each state a Pro and Con.
- Decision trade-off: selects alternative 3 for measured duplicate-work removal while preserving required conclusions, fail-closed behavior, package-owned commands, and the resource ceiling.
- New-surface placement: N/A — the proposal adds an internal harness primitive and extends existing verification/CI contracts; it introduces no package, app, presentation/interface surface, or layer/product-family reclassification.
- Completion Criteria identifiers: all 9 criteria use unique `TC-01` through `TC-09` prefixes.
- Completion Criteria coverage: distinct sub-items cover suite ownership, receipts, manifest classification, CI applicability, PTY coverage, bounded batching, timing, documentation, and final regression.
- Completion Criteria observability: every criterion specifies a command result, fixture selection/output, invocation count, recorded evidence, or explicit CI behavior; none uses the prohibited vague phrases.
- Test Plan presence: `## Test Plan` is present.
- Test Plan parity: 9 Completion Criteria (`TC-01`–`TC-09`) match 9 non-empty Test Plan rows one-to-one.
- Test Plan detail: every row has a non-empty Test Type and Tool / Approach; no row uses `TBD` or a manual-only tool requiring a Notes justification.
- Tasks structure: `## Tasks` is present with the pre-GATE-APPROVAL task-file placeholder.
- Evidence structure: `## Evidence Log` was present and empty before this first GATE-WRITE entry.
- Body metadata structure: no `## Status` or `## Classification` body section is present.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-13

**Status upgrade:** review-ready → approved

- Prior-gate ordering: the Evidence Log contains a specific `GATE-WRITE` PASS upgrading `draft → review-ready`, and the document currently declares `status: review-ready` in `.agents/spec-docs/backlog/`.
- Explicit user approval: after receiving the detailed recommendation covering duplicate harness-suite removal, exact same-object pre-push evidence reuse, semantic root-manifest classification, harness/product CI applicability, PTY matrix reduction, and bounded full-scope batching, the user stated verbatim: `그 모순을 모두 수정해 주세요`.
- Direct and unambiguous scope: “모두” authorizes implementation of all six recommendation areas captured by this spec rather than a different backlog item or a subset.
- Post-approval design stability: no subsequent change to the approved Architecture Review decision or to the `type` / `tags` classification is evidenced between that approval and this gate judgement.
- Independent architecture validation: N/A — the spec adds an internal harness primitive and changes existing verification/CI behavior; it introduces no package, app, presentation/interface surface, or layer/product-family reclassification.
- Pre-approval implementation trigger: no INFRA-091 implementation file, implementation commit, or verification-receipt primitive exists; the only current INFRA-091 tree change is this spec document.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-13

**Status upgrade:** approved → in-progress

- Prior-gate ordering: the Evidence Log contains a specific `GATE-APPROVAL` PASS upgrading `review-ready → approved`; the document declares `status: approved` and resides in the lifecycle folder `.agents/spec-docs/todo/` expected for that input state.
- Tasks file created: `.agents/tasks/INFRA-091-verification-evidence-reuse-and-scope-optimization.md` exists and identifies this spec in its `Spec` field.
- Tasks path recorded: the spec's `## Tasks` section records the exact task path and marks creation complete.
- Completion Criteria correspondence: the task file contains nine unchecked implementation tasks labelled `TC-01` through `TC-09`, providing one directly corresponding task for each of the spec's nine Completion Criteria.
- Task test plan: the task file contains a substantive `## Test Plan` section exceeding 50 characters; it specifies RED-first focused coverage for TC-01 through TC-07 and final harness, scan, TUI, scenario, and CI-equivalent verification for TC-09, with policy synchronization covered by the task set's TC-08.
- Implementation-without-task non-compliance trigger: not triggered because the required task file exists before GATE-IMPLEMENT authorization.
