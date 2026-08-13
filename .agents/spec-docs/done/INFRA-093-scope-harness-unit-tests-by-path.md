---
status: done
type: INFRA
tags: [typescript]
---

# INFRA-093: Scope harness self-tests by changed path

## Problem

Every push and every pull request targeting `develop` runs the complete harness self-test suite even
when the changed tree contains only product source or documentation. The current suite contains 180
test files and 3,263 tests and took 210–226 seconds in three consecutive local pre-push runs for PR
#1713; the same unconditional command took about 224 seconds in that PR's required `scans` job.

The reproduction is any clean product-only or documentation-only branch: `scripts/harness/pre-push.mjs`
always includes `pnpm harness:test` in `CI_SCANS_JOB_MIRROR`, while `.github/workflows/ci.yml` always
runs the same command in `scans`. The existing changed-path classifier cannot express whether harness
implementation, tests, configuration, or workflow wiring changed.

## Prior Art Research

GitHub Actions supports job and step conditions over outputs from prerequisite jobs, which permits an
expensive step to remain fail-closed while being skipped for a proven non-applicable change. GitHub's
documentation also warns that path filtering can leave required workflow checks pending when an entire
workflow is skipped, so this design keeps the required `scans` job present and gates only its self-test
step: <https://docs.github.com/actions/using-jobs/using-conditions-to-control-job-execution> and
<https://docs.github.com/actions/managing-workflow-runs/skipping-workflow-runs>.

The repository already follows the same coarse capability-classification pattern for product, TUI,
examples, and code paths. A repository audit found that the current suite cannot safely be treated as
entirely harness-local: 60 of 180 files directly reference the live repository, including tests that
traverse package source, hooks, rules, skills, and root configuration. Robota must first separate those
always-applicable repository-contract assertions from hermetic harness implementation tests. Only the
hermetic tier may be path-gated. Whenever harness implementation changes, both tiers run in full,
preserving HARNESS-021's prohibition on choosing individual tests within the applicable tier.

## Architecture Review

### Affected Scope

- `scripts/harness/classify-changed-paths.mjs` — canonical changed-path capability owner.
- `scripts/harness/pre-push.mjs` and `scripts/harness/verify-like-ci.mjs` — local required-scans mirrors.
- `scripts/harness/harness-test-tiers.mjs` and the root scripts — canonical tier membership and runners.
- `.github/workflows/ci.yml` — develop PR classifier output and `scans` step gate.
- `scripts/harness/__tests__/classify-changed-paths.test.mjs` and pre-push mirror tests.
- `.agents/specs/verification-pipeline-plan.md` and `scripts/harness/README.md` — verification ownership.

### Alternatives Considered

1. Keep the complete suite unconditional.
   - Pro: simplest and maximally conservative.
   - Con: repeats over three minutes of harness implementation tests on every unrelated push and PR.
2. Add independent path globs to the workflow and pre-push hook.
   - Pro: small local edits.
   - Con: creates two classifiers that can silently disagree and makes failure handling inconsistent.
3. First split live-repository contract tests into an always-on tier, mechanically reject unclassified
   live-tree access, then extend the canonical classifier with a fail-closed `harness` capability for
   the remaining hermetic tier.
   - Pro: one decision owner, product changes retain the assertions that inspect them, full harness
     changes retain both tiers, and failure remains conservative.
   - Con: requires a one-time test classification and a guard against future unclassified live-tree access.

### Decision

Choose alternative 3. `harness=true` for `scripts/harness/**`, `.github/workflows/**`,
`.agents/harness.config.json`, `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, `vitest.shared.ts`,
and `.npmrc`, plus every undeterminable classification. One exported `isHarnessOwnerPath` predicate
owns this exact set; workflows and hooks do not copy it. A canonical tier manifest owns only the
explicitly proven hermetic file set; every unlisted or unanalysable test is repository-contract by
default. A guard fails when a declared hermetic test cannot execute in the stripped repository or when
a declared file no longer exists. The
required `scans` job remains present and always runs the contract tier and `pnpm harness:scan`; only
the hermetic tier is gated. Local pre-push and `verify-like-ci` call the same classifier over their
resolved base range and use the same fail-closed value. Release verification remains fully conservative
here; exact release proof reuse is a separate follow-up because weakening a main gate without an exact
attestation would mix two independent decisions.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — existing code/product/TUI/examples capabilities and all classifier consumers inspected
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Add `harness` to every classifier result and to `$GITHUB_OUTPUT`. Classify the bounded harness-owner
path set as true and all product/docs-only changes as false; empty input, missing merge bases, and diff
failures remain true. Wire `changes.outputs.harness` into the required `scans` job with the repository's
cancellation-aware job condition: `!cancelled()`, a non-main target, and
`needs.changes.result != 'cancelled'`. This keeps classifier failures from making the required job
disappear without starting new work after a cancelled run. Skip the hermetic step only when a
successful classifier explicitly emits `harness=false`; missing output, classifier failure, and
`harness=true` all run it.

Introduce `harness:test:contracts` and `harness:test:hermetic`; unlisted tests belong to contracts, so
their union must equal the existing complete harness test directory without overlap. The hermetic list
is admitted only by an execution guard that copies `scripts/harness/**` plus the minimum Vitest/ESM
runtime into a temporary root, links dependencies, deliberately omits `.git`, `.github`, `.agents`,
`.claude`, `.husky`, packages, apps, and unrelated root files, and runs every declared hermetic test
there. This dynamically covers direct literals, imported-helper closure, spawned script targets, git,
subprocess cwd, and default-root access; any failure keeps the test in the always-on contract tier.
The guard also rejects missing entries, duplicate entries, zero-sized tiers, and a Vitest no-tests pass.
Replace unconditional local self-test stages with a plan derived from the same classification result:
pre-push classifies its resolved pushed range once, while verify-like-CI stores and reuses its existing
`changedFiles` classification in the run context. Contracts and scans always run; hermetic skips only
for an explicit `harness=false`. Tests must reject a second workflow-local path list, prove
product/docs skip only the hermetic tier, prove every owner path runs both tiers, and prove every
missing or unresolved state runs both.

## Affected Files

- `scripts/harness/classify-changed-paths.mjs`
- `scripts/harness/pre-push.mjs`
- `scripts/harness/verify-like-ci.mjs`
- `scripts/harness/harness-test-tiers.mjs`
- `package.json`
- `.github/workflows/ci.yml`
- `scripts/harness/__tests__/classify-changed-paths.test.mjs`
- `scripts/harness/__tests__/pre-push-mirrors-ci-scans.test.mjs`
- `.agents/specs/verification-pipeline-plan.md`
- `scripts/harness/README.md`
- `.agents/tasks/INFRA-093-scope-harness-unit-tests-by-path.md`

## Completion Criteria

- [x] TC-01: Tier tests prove the contract and hermetic sets are disjoint and complete; unlisted or
      unanalysable tests default to contract, and every hermetic test passes in the stripped repository.
- [x] TC-02: Classifier unit tests prove `harness=true` for every declared owner path and every
      failure/empty-input case, including rename/delete inputs, while representative product-only and
      docs-only inputs return false.
- [x] TC-03: CI workflow tests prove `scans` always runs, the contract tier is unconditional, the
      hermetic tier runs on `harness=true` or classifier failure, cancellation does not start new work,
      and `harness:scan` remains unconditional.
- [x] TC-04: Local pre-push and verify-like-CI tests prove both use canonical range classification,
      skip only the hermetic tier for a proven `harness=false`, and still run contracts and scans.
- [x] TC-05: `pnpm harness:test`, `pnpm harness:scan`, and `pnpm harness:verify-like-ci` exit 0 on the
      post-fix tree.

## Test Plan

| TC-ID | Test Type         | Tool / Approach                                                                                                                                                                            | Notes                                                              |
| ----- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| TC-01 | Unit              | `scripts/harness/__tests__/harness-test-tiers.test.mjs > harness test tiers` plus stripped-root execution                                                                                  | Completeness, disjointness, and dynamic live-tree boundary.        |
| TC-02 | Unit              | `scripts/harness/__tests__/classify-changed-paths.test.mjs > classifyFiles / classifyRange`                                                                                                | Owner paths, rename/delete inputs, and fail-closed git errors.     |
| TC-03 | CI pipeline smoke | `scripts/harness/__tests__/classify-changed-paths.test.mjs > CI capability wiring`                                                                                                         | Parsed required-job wiring and explicit-false-only skip semantics. |
| TC-04 | Unit/integration  | `scripts/harness/__tests__/pre-push-mirrors-ci-scans.test.mjs > the pre-push gate mirrors...` and `verify-like-ci.test.mjs > stageGate`                                                    | Shared applicability result and local plan behavior.               |
| TC-05 | Regression        | Test skipped: this criterion is the aggregate root-command execution itself, so wrapping those commands in another test function would duplicate rather than independently verify the gate | Commands are executed directly and their exit codes recorded.      |

## Tasks

- [x] `.agents/tasks/completed/INFRA-093-scope-harness-unit-tests-by-path.md` — implementation and verification complete

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-14

**Status upgrade:** draft → review-ready
Frontmatter: valid YAML block; `status: draft`, permitted `type: INFRA`, and `tags: [typescript]` are present.
Problem: identifies the unconditional `pnpm harness:test` behavior in local pre-push and develop-PR scans, gives measured 210–226/224-second symptoms, and states the product/docs-only reproduction condition without TBD/TODO language.
Prior Art Research: cites two first-party GitHub Actions documentation sources and a repository audit; the findings directly support the tier-splitting and step-gating alternatives and decision.
Architecture Review Checklist: all four items are checked; the sibling scan names inspected classifier consumers; three alternatives include pros and cons; the decision states the canonical-owner, fail-closed, and contract-coverage trade-offs.
New-surface placement: N/A — this change introduces no package, app, presentation/interface surface, or layer/product-family reclassification.
Completion Criteria: TC-01 through TC-05 cover tier integrity, classifier behavior, CI behavior, local mirrors, and regression commands using observable or command-form requirements.
Test Plan: 5 completion criteria and 5 corresponding test-plan rows match exactly; every row has a non-empty type and automated tool/approach.
Structure: Tasks placeholder and empty Evidence Log were present before this entry; no body Status or Classification section exists.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-14

**Status upgrade:** review-ready → approved
User approval: “추천 우선순위 대로 전부 진행해서 완료해줘.” The statement directly authorizes every item in the previously presented prioritized recommendation; INFRA-093 was recommendation priority 1.
Approval mechanism and stability: the user’s standing instruction approves a reasoned recommendation when found valid, and the final proposal received an independent `REVIEW VERDICT: ENDORSE`; no subsequent Architecture Review or frontmatter `type`/`tags` modification was identified.
Independent architecture validation: N/A as a mandatory condition — the spec introduces no new package, app, presentation/interface surface, or layer/product-family reclassification; an independent proposal review nevertheless returned `ENDORSE`.
Ordering and compliance: GATE-WRITE is recorded PASS, the document entered approval as `review-ready` in `.agents/spec-docs/backlog/`, and no implementation work began before approval.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-14

**Status upgrade:** approved → in-progress
Tasks file: `.agents/tasks/INFRA-093-scope-harness-unit-tests-by-path.md` exists and is linked from the spec document’s `## Tasks` section.
TC-01 task: split harness tests into fail-closed repository-contract and proven-hermetic tiers.
TC-02 task: add the canonical harness-owner capability and failure matrix.
TC-03 task: gate only the hermetic tier in required CI while contracts and scans remain present.
TC-04 task: reuse the same applicability result in pre-push and verify-like-CI.
TC-05 task: run focused, full-harness, scan, and CI-equivalent verification and record evidence.
Test planning: the Task’s `## Test Plan` is substantive at 407 characters, exceeding the ≥50-character requirement.

### [IMPLEMENTATION-PROGRESS] — 2026-08-14

TDD RED evidence: the classifier suite reported 16 failures before `harness` existed; the tier suite
failed to load before its owner module existed; CI/local planning suites reported four failures before
the workflow and runners were changed.

Targeted GREEN evidence: 9 test files / 265 tests passed, including classifier, tier partition,
CI/local mirror, verify-like-CI, mirror-map, TEST-011, and required-check conditions. A one-pass
stripped-root discovery admitted only the 72 of 181 files that passed; the final
`pnpm harness:test:tiers:guard` then passed all 72 files / 1,052 tests together from
`/tmp/robota-harness-hermetic-*` without live repository owners.

Final GREEN evidence: `pnpm harness:test`, `pnpm harness:scan` (108 passed, 2 skipped), and
`pnpm harness:verify-like-ci` all exited 0 on the post-fix tree. The CI-equivalent run completed all
12 locally reproducible stages, including package builds/tests/typechecks/lint and the real TUI PTY
suite. The release-only network, Windows, and GitHub code-scanning checks remain correctly delegated
to required CI rather than represented as local passes.

### [GATE-VERIFY] — ✅ PASS | 2026-08-14

**Status upgrade:** in-progress → verifying
Task completion: `.agents/tasks/INFRA-093-scope-harness-unit-tests-by-path.md` has TC-01 through TC-05 all marked `[x]`; no unchecked, pending, or blocked task remains, and `## Blockers` records `None`.
Build verification: independently ran `pnpm build`; the complete workspace package JS/type build passed.
Test verification: independently ran `pnpm test` after the successful build; all workspace test commands passed.
Combined command result: `pnpm build && pnpm test` exited 0.
Focused implementation evidence was also inspected: 9 files / 265 tests passed, the 72-file / 1,052-test stripped-root hermetic guard passed, and `pnpm harness:test`, `pnpm harness:scan`, and `pnpm harness:verify-like-ci` each exited 0.

### [GATE-COMPLETE: TC-01] — verification evidence | 2026-08-14

Command: `pnpm harness:test:hermetic` and the focused Vitest tier suite.
Observed result: the complete 181-file inventory partitioned into 109 repository-contract files and 72 hermetic files with no overlap; all 72 hermetic files / 1,052 tests passed in the stripped repository.
Exit code: 0.
Test written: `scripts/harness/__tests__/harness-test-tiers.test.mjs > harness test tiers`.

### [GATE-COMPLETE: TC-02] — verification evidence | 2026-08-14

Command: focused Vitest execution including `scripts/harness/__tests__/classify-changed-paths.test.mjs`.
Observed result: owner-path, documentation-under-owner, empty input, missing merge-base, failed diff, rename, and delete cases passed; `harness` is emitted fail-closed.
Exit code: 0.
Test written: `scripts/harness/__tests__/classify-changed-paths.test.mjs > classifyFiles / classifyRange (fail-closed on git)`.

### [GATE-COMPLETE: TC-03] — verification evidence | 2026-08-14

Command: focused Vitest execution including classifier CI wiring and harness script workflow assertions.
Observed result: the required `scans` job preserves cancellation semantics, runs repository contracts and scans unconditionally, and skips hermetic tests only for an explicit successful `harness=false` result.
Exit code: 0.
Test written: `scripts/harness/__tests__/classify-changed-paths.test.mjs > CI capability wiring`.

### [GATE-COMPLETE: TC-04] — verification evidence | 2026-08-14

Command: focused Vitest execution including pre-push CI mirror and verify-like-CI stage-gate suites.
Observed result: both local entrypoints reuse canonical classification, preserve contracts/scans, and run hermetic tests on missing or failed classification.
Exit code: 0.
Test written: `scripts/harness/__tests__/pre-push-mirrors-ci-scans.test.mjs > the pre-push gate mirrors the required scans context` and `scripts/harness/__tests__/verify-like-ci.test.mjs > stageGate`.

### [GATE-COMPLETE: TC-05] — verification evidence | 2026-08-14

Commands: `pnpm harness:test`; `pnpm harness:scan`; `pnpm harness:verify-like-ci`; independent `pnpm build && pnpm test`.
Observed result: all commands exited 0; scan reported 108 passed and 2 skipped, verify-like-CI passed all 12 locally reproducible stages, and the independent full workspace build/test completed successfully.
Exit codes: 0 for every command.
Test skipped: this criterion directly requires execution of the aggregate root commands; wrapping those same commands in a test function would duplicate the gate rather than independently verify it. The commands and exit codes are recorded above. A user-execution scenario is also not applicable because no shipped product behavior changes.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-14

**Status upgrade:** verifying → done
TC-01: checked; complete/disjoint tier partition and stripped-root execution are evidenced with exit code 0; test reference is `scripts/harness/__tests__/harness-test-tiers.test.mjs > harness test tiers`.
TC-02: checked; canonical owner-path and fail-closed classification matrix is evidenced with exit code 0; classifier suite references exist.
TC-03: checked; required CI job, unconditional contract/scan stages, cancellation handling, and fail-closed hermetic gate are evidenced with exit code 0; CI wiring suite reference exists.
TC-04: checked; pre-push and verify-like-CI canonical applicability behavior is evidenced with exit code 0; both local-planning suite references exist.
TC-05: checked; all aggregate root commands and exit codes are recorded, and both Test Plan and TC evidence explicitly record why a separate wrapper test was skipped.
Test Plan: every TC has an exact test reference or catalogue-compliant explicit skip reason.
Task: `.agents/tasks/INFRA-093-scope-harness-unit-tests-by-path.md` was completion-ready with TC-01 through TC-05 complete and no pending or blocked item; Phase 5 archives it at `.agents/tasks/completed/INFRA-093-scope-harness-unit-tests-by-path.md`.
