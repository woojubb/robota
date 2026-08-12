---
status: done
type: INFRA
tags: [cli, typescript]
completed: 2026-08-13
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

- [x] TC-01: A harness-change fixture causes one full harness-suite invocation in each of
      `verify-like-ci`, pre-push, and develop CI ownership graphs; an unknown selective-skip name exits non-zero.
- [x] TC-02: A full clean-tree CI-equivalent PASS creates an exact receipt; unchanged same-object/base/tool
      pre-push reports receipt reuse, while dirty, partial, malformed, stale-base, stale-tool, weaker-profile,
      and different-pushed-object fixtures all run verification.
- [x] TC-03: Root manifest fixtures changing only `lint:fix` / `lint:fix:staged` select 0 product scopes;
      dependency, override, engine, build/test/typecheck/lint/lifecycle, mixed, parse-error, and unknown changes
      select all configured scopes.
- [x] TC-04: Harness-only CI fixtures set `code=true` and product/TUI/examples runtime applicability false;
      required jobs still conclude success through an explicit non-applicable step, while classifier failure
      runs every safety-relevant job.
- [x] TC-05: The TUI unit suite still executes all terminal/override capability cells and the PTY suite
      executes the four representative boundary cells plus wide/narrow positioning and real-tmux coverage;
      `pnpm --filter @robota-sdk/agent-transport-tui test:pty` exits 0.
- [x] TC-06: A synthetic full-workspace plan executes each planned package-owned test/lint/typecheck script
      through bounded batching, rejects missing per-scope evidence, aggregates multiple failures, and performs
      fewer command launches than the serial baseline.
- [x] TC-07: `pnpm harness:verify-like-ci -- --only format-check --only harness-self-test` prints per-stage
      and total elapsed times and does not create a full-gate receipt; a full PASS prints timing and creates one.
- [x] TC-08: Verification policy and the cross-cutting verification plan describe targeted development,
      one pre-merge full gate, exact receipt invalidation, and measured timing without the stale 3.5-5 minute claim.
- [x] TC-09: Focused harness tests, `pnpm harness:scan`, TUI unit/PTy tests, and final
      `pnpm harness:verify-like-ci` all exit 0 on the post-fix tree; independent scenario applicability
      is recorded as `NOT-APPLICABLE` because no shipped product surface changed.

## Test Plan

| TC-ID | Test Type                 | Tool / Approach                                                                                                                                                                                           | Notes                                         |
| ----- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| TC-01 | CI pipeline unit/contract | `scripts/harness/__tests__/harness-scripts.test.mjs > repository-check ownership`; `verify-like-ci.test.mjs > CI_STAGES`                                                                                  | One owner and unknown fail-closed             |
| TC-02 | Integration/unit          | `scripts/harness/__tests__/verification-receipt.test.mjs > exact verification receipts`; `pre-push-sequence.test.mjs > runPrePushGate step order`                                                         | Exact match/invalidation                      |
| TC-03 | Unit                      | `scripts/harness/__tests__/check-plan.test.mjs > createVerificationPlan`                                                                                                                                  | Narrow allowlist and full fallback directions |
| TC-04 | CI pipeline contract      | `scripts/harness/__tests__/classify-changed-paths.test.mjs > classifyFiles`; `harness-scripts.test.mjs > CI build workflow`                                                                               | Required jobs remain/fail closed              |
| TC-05 | Unit + process E2E        | `packages/agent-transport-tui/src/__tests__/terminal-capabilities.test.ts > CLI-062 terminal matrix`; `packages/agent-transport-tui/src/__tests__/pty/ime-cursor.ptytest.ts > observable cursor contract` | Logic plus real boundaries                    |
| TC-06 | Integration/unit          | `scripts/harness/__tests__/workspace-check-batches.test.mjs > bounded full-workspace check batches`                                                                                                       | Missing evidence/multi-failure aggregation    |
| TC-07 | CLI integration           | `scripts/harness/__tests__/verify-like-ci.test.mjs > summarize`; `verification-receipt.test.mjs > exact verification receipts`                                                                            | Partial never certifies full                  |
| TC-08 | Governance                | `scripts/harness/__tests__/harness-scripts.test.mjs > repository-check ownership`; `gate-completion-order.test.mjs > GATE-COMPLETE transition ownership`                                                  | Owner contracts agree                         |
| TC-09 | Regression/CI smoke       | `scripts/harness/__tests__/verify-like-ci.test.mjs > CI_STAGES`; `scripts/harness/__tests__/gate-completion-order.test.mjs > GATE-COMPLETE transition ownership`; TUI suites, scan, full gate             | Final evidence                                |

## User Execution Test Scenarios

**Applicability:** not-applicable

This work changes repository-internal verification and governance mechanisms only. It changes no shipped
Robota CLI, TUI, browser, application, public SDK, or example behavior. Its executable observables are
build, test, lint, harness, Git-hook, and CI results, which the backlog-execution rule explicitly reserves
for engineering verification and forbids as User Execution evidence. They remain covered by the Test Plan;
no product-surface scenario is invented. Independent scenario-author outcome on 2026-08-13:
`NOT-APPLICABLE`; the execution gate is skipped.

## Tasks

- [x] `.agents/tasks/completed/INFRA-091-verification-evidence-reuse-and-scope-optimization.md` — completed implementation record

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

### [IMPLEMENTATION EVIDENCE] — ✅ COMPLETE | 2026-08-13

- Focused RED/GREEN: ten harness test files passed 264 tests after each new contract was observed failing
  before implementation; TUI exhaustive capability tests passed 36 tests.
- Full harness: `pnpm harness:test` passed 176 files and 3,209 tests in 219.02 seconds.
- Harness governance: `pnpm harness:scan` passed 108 scans with one intentional skip and three advisories.
- Real process coverage: `pnpm --filter @robota-sdk/agent-transport-tui test:pty` passed 23 tests with
  three tmux-only skips in 35.54 seconds; the capability matrix now owns exhaustive logical coverage.
- Exact full gate: clean commit `83a878e185b446095121a7d8135ba2f6049ab2f7` passed all 11 mirrored stages
  in 8m37.6s and wrote the exact receipt. Stage owners were harness-self-test 3m38.0s,
  affected-verify 2m17.2s, build 1m29.4s, TUI E2E 36.2s, and 36.8s combined for the remaining stages.
- Scenario applicability: an independent author returned `NOT-APPLICABLE` because all executable
  observables are engineering/governance verification rather than a shipped product surface. Exact receipt
  reuse, developer-quality-only planning, and harness-only CI classification remain Test Plan evidence.

### [DONE-GATE AUDIT] — ↩ NOT-APPLICABLE | 2026-08-13

- Initial audit: `DONE-GATE-STAGE-1: FAIL` and `DONE-GATE-STAGE-2: NON-COMPLIANCE`. The original drafts
  lacked executability decisions, retained fixture placeholders, mismatched two recorded commands, and
  incorrectly treated harness/CI results as product-surface User Execution evidence. No completion state
  or archival move preceded that verdict.
- Corrected PLAN disposition: independent scenario author returned `NOT-APPLICABLE`; an independent
  guardian returned `PLAN applicability: PASS` and `PHASE-4 SKIP ROUTING: PASS`. The work changes only
  repository-internal engineering/governance verification and exposes no shipped product capability.
  Per `user-execution-scenario` routing, Mode GATE is skipped rather than retroactively marked PASS.

### [GATE-VERIFY] — ✅ PASS | 2026-08-13

**Status upgrade:** in-progress → verifying

- Task completion: TC-01 through TC-09 are all `[x]`; no blocked or pending item remains.
- Build/test: clean commit `83a878e185b446095121a7d8135ba2f6049ab2f7` passed all 11
  `pnpm harness:verify-like-ci` stages, including build and 35 affected scopes. The complete harness suite
  additionally passed 176 files / 3,209 tests, and TUI unit/PTY and scan suites passed.
- Post-gate diff: only INFRA-091 evidence/applicability documentation changed; `git diff --check`,
  `pnpm harness:scan:test-plans`, and `pnpm harness:scan:task-archival` exited 0.
- User Execution: independently judged `NOT-APPLICABLE`; the valid Phase 4 skip is not a failure.

### [GATE-COMPLETE: TC-01] — ✅ VERIFIED | 2026-08-13

- Action: `pnpm exec vitest run scripts/harness/__tests__/harness-scripts.test.mjs
scripts/harness/__tests__/verify-like-ci.test.mjs`, then `pnpm harness:verify-like-ci`.
- Result: duplicate repository-check ownership was absent; unknown omission names failed closed; full gate
  exited 0. Tests: `scripts/harness/__tests__/harness-scripts.test.mjs` and
  `scripts/harness/__tests__/verify-like-ci.test.mjs`.

### [GATE-COMPLETE: TC-02] — ✅ VERIFIED | 2026-08-13

- Action: `pnpm exec vitest run scripts/harness/__tests__/verification-receipt.test.mjs
scripts/harness/__tests__/pre-push-sequence.test.mjs`, then clean `pnpm harness:verify-like-ci` and
  `pnpm harness:pre-push` on commit `83a878e18`.
- Result: receipt fixtures covered malformed/stale/dirty/weaker/object mismatches; the real full gate wrote
  an exact receipt and pre-push exited 0 in 1.2s with `exact verify-like-ci receipt reused`.
  Tests: `verification-receipt.test.mjs` and `pre-push-sequence.test.mjs`.

### [GATE-COMPLETE: TC-03] — ✅ VERIFIED | 2026-08-13

- Action: ran `pnpm exec vitest run scripts/harness/__tests__/check-plan.test.mjs`, then
  `pnpm harness:plan -- --base-ref origin/develop --changed-file package.json`.
- Result: command exited 0 with `Root manifest: developer-quality-only` and `0 of 86`; unsafe, mixed,
  unknown, and parse-error fixtures selected all scopes.

### [GATE-COMPLETE: TC-04] — ✅ VERIFIED | 2026-08-13

- Action: ran `pnpm exec vitest run scripts/harness/__tests__/classify-changed-paths.test.mjs
scripts/harness/__tests__/harness-scripts.test.mjs`, then
  `node --input-type=module -e "const {classifyFiles}=await import('./scripts/harness/classify-changed-paths.mjs'); console.log(JSON.stringify(classifyFiles(['scripts/harness/example.mjs'])))"`.
- Result: exit 0 and `{code:true, product:false, tui:false, examples:false}`; classifier failure fixtures
  set all safety capabilities true and required jobs retained explicit N/A steps. Tests:
  `classify-changed-paths.test.mjs` and `harness-scripts.test.mjs`.

### [GATE-COMPLETE: TC-05] — ✅ VERIFIED | 2026-08-13

- Action: ran `pnpm --filter @robota-sdk/agent-transport-tui exec vitest run
src/__tests__/terminal-capabilities.test.ts` and
  `pnpm --filter @robota-sdk/agent-transport-tui test:pty`.
- Result: unit suite passed all 36 tests; PTY exited 0 with 23 passed / 3 tmux-only skipped in 35.54s,
  including four terminal boundaries and both viewport geometries. Tests:
  `packages/agent-transport-tui/src/__tests__/terminal-capabilities.test.ts > CLI-062 terminal matrix`
  and `packages/agent-transport-tui/src/__tests__/pty/ime-cursor.ptytest.ts > observable cursor contract`.

### [GATE-COMPLETE: TC-06] — ✅ VERIFIED | 2026-08-13

- Action: ran `pnpm exec vitest run scripts/harness/__tests__/workspace-check-batches.test.mjs` and
  exercised the full-plan aggregate path in the final gate.
- Result: bounded concurrency, package-script ownership, missing-result rejection, and multi-failure
  aggregation passed; full-plan test/lint/typecheck used one bounded recursive launch per check.

### [GATE-COMPLETE: TC-07] — ✅ VERIFIED | 2026-08-13

- Action: ran `pnpm exec vitest run scripts/harness/__tests__/verify-like-ci.test.mjs
scripts/harness/__tests__/verification-receipt.test.mjs`, a partial
  `pnpm harness:verify-like-ci -- --only format-check`, and a clean full `pnpm harness:verify-like-ci`.
- Result: partial execution printed timings without a receipt; the full command exited 0, printed all stage
  durations plus total `8m 37.6s`, and wrote the receipt. Tests: `verify-like-ci.test.mjs` and
  `verification-receipt.test.mjs`.

### [GATE-COMPLETE: TC-08] — ✅ VERIFIED | 2026-08-13

- Action: synchronized verification policy, pipeline plan, Git rule, and TUI SPEC; ran
  `pnpm exec vitest run scripts/harness/__tests__/harness-scripts.test.mjs
scripts/harness/__tests__/gate-completion-order.test.mjs` and `pnpm harness:scan:consistency`.
- Result: both exited 0; all owners describe targeted development, one final full gate, exact invalidation,
  stage timings, and the same CI execution graph.

### [GATE-COMPLETE: TC-09] — ✅ VERIFIED | 2026-08-13

- Action: ran the exact eight-file focused Vitest command recorded in the final summary, complete harness
  (176 files / 3,209 tests), `pnpm harness:scan` (108 pass / 1 intentional skip), TUI unit (36 tests), TUI PTY
  (23 pass / 3 tmux-only skip), and clean `pnpm harness:verify-like-ci`.
- Result: every command exited 0; the full gate passed all 11 stages in 8m37.6s. Independent User Execution
  applicability was `NOT-APPLICABLE` because no shipped product surface changed.

### [BLOCKING POLICY CONTRADICTION] — ✅ ROOT FIX | 2026-08-13

- Finding: the first GATE-COMPLETE review correctly returned FAIL because the catalogue required an
  already-archived task and archived pointer before PASS, while `spec-workflow`, `backlog-execution`, and
  Phase 5 prohibit those PASS outputs before the gate. No ordering could satisfy both contracts.
- Independent proposal review: `REVIEW VERDICT: ENDORSE`. The reviewer confirmed the defect was a
  foundational input/output inversion and endorsed correcting the guardian preconditions at their owner,
  while preserving post-PASS transition ownership in the existing orchestrators.
- Correction: GATE-COMPLETE now requires the exact active task path and a completion-ready active task.
  Archival, terminal status/date, pointer update, and spec move remain atomic PASS outputs. A focused
  relational regression is owned by `scripts/harness/__tests__/gate-completion-order.test.mjs`.

### [GATE-COMPLETE SUMMARY] — READY | 2026-08-13

- Exact focused command:
  `pnpm exec vitest run scripts/harness/__tests__/check-plan.test.mjs scripts/harness/__tests__/classify-changed-paths.test.mjs scripts/harness/__tests__/harness-scripts.test.mjs scripts/harness/__tests__/pre-push-sequence.test.mjs scripts/harness/__tests__/verification-receipt.test.mjs scripts/harness/__tests__/verify-like-ci.test.mjs scripts/harness/__tests__/workspace-check-batches.test.mjs scripts/harness/__tests__/gate-completion-order.test.mjs`.
- Exact focused result: exit 0; 8 files passed and 197 tests passed in 551ms.
- TC-01 through TC-09 are checked and each has exact verification action, observed result, exit status,
  and a Test Plan owner in the entries above. The active Task is completion-ready and the `## Tasks`
  pointer names its exact active path.
- On guardian PASS, Phase 5 will atomically set terminal status/date, archive the Task, move this spec to
  `done/`, update the Task pointer, and run placement/archival scans before the closing commit.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-13

**Status upgrade:** verifying → done

- Independent guardian verdict: TC-01 through TC-09 PASS; every criterion has exact action, observed
  result, exit evidence, and a full test path plus actual describe/function owner.
- Final criteria: all checkboxes, per-TC evidence entries, Test Plan references, final summary, exact active
  task pointer, and completion-ready state passed.
- User Execution: independently `NOT-APPLICABLE`; Phase 4 skip is valid because no shipped product surface
  changed and engineering verification cannot be substituted as User Execution evidence.
- Phase 5: terminal status/date, Task archive, spec `done/` move, and archived Task pointer are assembled
  together for the closing commit; placement and archival scans verify the final state.
