---
status: done
type: INFRA
tags: [cli, typescript]
---

# INFRA-100: Make harness verification portable on the supported macOS toolchain

## Problem

On macOS with the repository-pinned Node 22.14.0 and the system `/bin/bash` 3.2,
`pnpm harness:verify -- --scope packages/agent-provider-replay --include-scenarios` reaches the
repository harness tests but fails 27 cases. Twenty failures come from temporary fixture paths whose
`/var/...` spelling resolves to `/private/var/...`, so direct-execution guards compare two spellings of
the same file and silently skip their `main()`. Six execution-witness failures come from dynamic file
descriptor syntax and `BASH_XTRACEFD`, which the system Bash cannot provide. One worktree-lock test uses
GNU `date +%s%3N`; BSD `date` prints a non-millisecond value, making both interval endpoints identical.

With `TMPDIR` set to its `realpath`, the path-alias failures disappear and the remaining seven failures
reproduce deterministically. These are repository-level verification defects: they block every scoped
harness gate on a supported development host even though the changed package is unrelated.

## Prior Art Research

### Observed common behavior

1. **Bash execution-line evidence.** Bash `set -x` emits expanded commands before execution, prefixes
   them with expanded `PS4`, and normally writes the trace to standard error. `PS4` can carry a stable
   marker plus `${BASH_SOURCE}:${LINENO}`. A `DEBUG` trap can write directly to a separate file, but its
   inheritance into functions, substitutions, and subshells depends on tracing options and therefore
   must be enabled and tested explicitly. [Bash `set -x` and `PS4`](https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html),
   [Bash variables](https://www.gnu.org/software/bash/manual/html_node/Bash-Variables.html),
   [Bash DEBUG-trap inheritance](https://www.gnu.org/software/bash/manual/html_node/Major-Differences-From-The-Bourne-Shell.html)
2. **Portable millisecond timing.** GNU documents `%N` as an extension, so `date +%s%3N` is not a
   portable clock. Node 22 provides `performance.now()` for high-resolution elapsed milliseconds and
   `process.hrtime.bigint()` when integer nanosecond arithmetic is needed. The harness already requires
   Node 22, so Node—not a platform-specific `date`—should own timing.
   [GNU time conversion specifiers](https://www.gnu.org/software/coreutils/manual/html_node/Time-conversion-specifiers.html),
   [Node 22 `performance.now()`](https://nodejs.org/download/release/v22.14.0/docs/api/perf_hooks.html#performancenow)
3. **Canonical temporary paths.** Node's temporary directory honors environment overrides, while the
   same macOS filesystem object may be exposed through `/var/...` and `/private/var/...`. Existing path
   identity must therefore be resolved with `fs.realpath` before it is compared or supplied as a fixture
   root. [Node 22 `fs.realpath`](https://nodejs.org/download/release/v22.14.0/docs/api/fs.html#fspromisesrealpathpath-options),
   [Apple path resolution behavior](https://developer.apple.com/documentation/foundation/nsurl/resolvingsymlinksinpath)

### Constraint for Robota

- macOS `/bin/bash` 3.2 must produce execution evidence without dynamic descriptors or
  `BASH_XTRACEFD`.
- The witness must keep ordinary stderr intact, preserve the child exit status, and prove actual
  executed lines rather than scan source text.
- Linux and macOS must use the same Node-owned timing and canonical temporary-root behavior.
- Raw traces may contain expanded arguments, so they remain ephemeral local evidence.

## Architecture Review

### Affected Scope

- `scripts/harness/lib/execution-witness.mjs` — Bash execution-line evidence prelude.
- `scripts/harness/__tests__/check-regression-red-proof-execution-witness.test.mjs` — Bash 3.2,
  stderr-isolation, branch, function/subshell reachability evidence.
- `scripts/harness/__tests__/worktrees-share-the-stash.test.mjs` — portable concurrent-interval clock
  and hermetic test-only `flock` fixture.
- `scripts/harness/verify-change.mjs` — canonical temporary root injected only into the harness-test
  subprocess.
- `scripts/harness/__tests__/harness-scripts.test.mjs` — canonical temporary-root projection contract.

### Alternatives Considered

1. **Require local Bash 5 and GNU coreutils.** Pro: preserves the current implementation. Con: violates
   the supported stock macOS toolchain, adds host setup outside the repository, and still leaves the
   `/var` path-alias defect.
2. **Skip the affected tests on macOS.** Pro: small change. Con: converts missing evidence into a green
   gate and allows precisely the execution/locking regressions the tests are meant to catch.
3. **Use platform-neutral evidence primitives and canonicalize the harness-test temp root.** Pro: one
   behavior on Linux and macOS, no external tool installation, actual execution evidence remains
   fail-closed. Con: the Bash witness must explicitly test DEBUG-trap inheritance and fixed descriptor
   isolation.
4. **Replace all direct-execution guards repository-wide with realpath comparisons.** Pro: makes every
   copied script alias-tolerant independently. Con: changes more than 100 harness entrypoints and their
   fixtures when only the harness-test subprocess creates aliased temporary copies; the blast radius is
   disproportionate to this failure.

### Decision

Choose alternative 3. `verify-change` resolves `os.tmpdir()` once with `realpathSync` and passes that
canonical value as `TMPDIR` only to its `harness-tests` child process. The Bash prelude uses a dedicated
fixed high-numbered descriptor plus a `DEBUG` trap with function-trace inheritance enabled, retaining
the current out-of-band trace file and ordinary stderr. Existing branch evidence is extended with a
function/subshell case so inheritance is measured rather than assumed. The lock test supplies a
test-only Bash-3-compatible `flock` fixture so its proof does not depend on a host package, then
records `IN` and `OUT` observations against a single parent-process `performance.now()` clock rather
than shelling out to `date`. The production wrapper's documented missing-`flock` degradation remains
unchanged and is covered separately.

This preserves every existing consumer: `witnessOneCase` still reads the same tagged trace file,
`runVitestRaw` still receives the same two environment variables, and `verify-change` still runs the
same complete harness test directory. Failure modes were checked adversarially: missing trace output
remains `UNKNOWN`, noncanonical fixture paths can no longer silently suppress a copied CLI, ordinary
stderr remains visible, and the unlocked lock fixture must still demonstrate real overlap.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — execution-witness callers, harness-test launcher, and worktree-lock tests inspected
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Add a pure `canonicalTemporaryDirectory()` helper in `verify-change.mjs` and project its result into
   the `harness-tests` child environment; test the realpath identity and dry-run command contract.
2. Replace the Bash-4-only xtrace prelude with a Bash-3-compatible, out-of-band `DEBUG`-trap recorder on
   a dedicated descriptor, explicitly enabling inheritance. Keep the existing trace syntax consumed by
   `parseXtrace`.
3. Extend the witness tests to prove executed/not-executed branches, function/subshell reachability,
   unchanged ordinary stderr, and inert behavior without the trace environment.
4. Give the worktree concurrency test a hermetic Bash-3-compatible `flock` fixture, then have its
   parent Node process timestamp parsed `IN`/`OUT` markers with `performance.now()`; preserve the
   locked non-overlap and unlocked-overlap assertions without host `flock` or GNU `date`.
5. Run the focused RED/GREEN suites, the complete harness test directory, and the original scoped
   ARCH-014 verification command without an ad-hoc `TMPDIR` override.

## Affected Files

- `scripts/harness/verify-change.mjs`
- `scripts/harness/__tests__/harness-scripts.test.mjs`
- `scripts/harness/lib/execution-witness.mjs`
- `scripts/harness/__tests__/check-regression-red-proof-execution-witness.test.mjs`
- `scripts/harness/__tests__/worktrees-share-the-stash.test.mjs`
- `.agents/tasks/INFRA-100-macos-harness-portability.md`

## Completion Criteria

- [x] TC-01: On macOS Bash 3.2, the execution-witness test records only executed branch lines, reaches
      function/subshell lines, leaves ordinary stderr unchanged, and exits 0.
- [x] TC-02: The worktree-lock suite requires neither host `flock` nor `date +%s%3N`, proves locked
      intervals do not overlap and unlocked intervals do overlap, and exits 0 on macOS and Linux.
- [x] TC-03: The harness-test launcher supplies `realpathSync(tmpdir())` as `TMPDIR`, while every other
      repository check keeps its existing environment contract.
- [x] TC-04: `pnpm exec vitest run scripts/harness/__tests__ --pool=threads --maxWorkers=2
--testTimeout=30000 --reporter=dot` exits 0 when invoked through `pnpm harness:verify` without a
      caller-provided `TMPDIR` override.
- [x] TC-05: `pnpm harness:verify -- --scope packages/agent-provider-replay --include-scenarios` exits 0
      and reports a matching canonical `external-payload-replay.record.json`.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                                | Notes                                                                                                                        |
| ----- | ------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | CI pipeline smoke test   | Focused Vitest execution-witness suite under stock `/bin/bash`                 | `check-regression-red-proof-execution-witness.test.mjs > bash execution witness` and `witnessOneCase wiring`                 |
| TC-02 | CI pipeline smoke test   | Focused Vitest with hermetic `flock` fixture and Node monotonic timing         | `worktrees-share-the-stash.test.mjs > a worktree does not share its neighbour lint-staged backup`                            |
| TC-03 | Unit test                | `harness-scripts.test.mjs` projection assertion plus realpath identity fixture | `repository-check ownership > canonicalizes only the complete harness-test temp root`                                        |
| TC-04 | CI pipeline smoke test   | Complete `scripts/harness/__tests__` invocation through `harness:verify`       | Command-only integration gate: exact command is in TC-04; GATE-VERIFY records 186 files and 3364/3364 tests.                 |
| TC-05 | Process integration test | Scoped harness verification with package-owned scenario record comparison      | Command-only process scenario: exact command is in TC-05; owner is `examples/verify-session-log-external-payload-replay.ts`. |

## Tasks

- [x] `.agents/tasks/completed/INFRA-100-macos-harness-portability.md` — implementation and verification complete

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-15

**Status upgrade:** draft → review-ready

- Frontmatter block: file begins with YAML frontmatter and declares `status: draft`.
- Frontmatter type: `type: INFRA` is one of the 11 permitted taxonomy values.
- Frontmatter tags: `tags: [cli, typescript]` is present.
- Problem symptom: names the failing scoped `harness:verify` command and quantifies the 27 failures by cause.
- Problem reproduction: identifies stock macOS `/bin/bash` 3.2 with repository-pinned Node 22.14.0 and the `TMPDIR` canonicalization control result.
- Problem quality: contains neither `TBD` nor `TODO` and is a substantiated multi-paragraph diagnosis.
- Prior Art Research presence: `## Prior Art Research` is present.
- Prior Art Research substantiation: cites GNU Bash, GNU Coreutils, Node.js 22, and Apple documentation sources.
- Research-to-decision trace: Bash tracing, Node-owned timing, and realpath identity findings feed alternatives 1–4 and the choice of alternative 3.
- Architecture checklist: all four required items are checked.
- Sibling scan: checked with evidence naming execution-witness callers, the harness-test launcher, and worktree-lock tests.
- Alternatives: four alternatives each state a concrete pro and con.
- Decision trade-off: chooses portable shared primitives and scoped temp-root canonicalization to preserve evidence while avoiding host prerequisites, skipped tests, and repository-wide churn.
- New-surface placement: N/A — the document changes internal harness implementation and tests only; it introduces no package, app, presentation, public interface, layer reclassification, or product-family boundary.
- Completion Criteria identifiers: all five items use unique `TC-01` through `TC-05` prefixes.
- Completion Criteria coverage: distinct criteria cover execution tracing, timing/locking, temp-root projection, full harness tests, and the original scoped verification scenario.
- Completion Criteria observability: every criterion names an exact command result or externally observable trace, timing, environment, or scenario-record behavior.
- Completion Criteria wording: none uses “works correctly”, “no errors”, “implemented”, or “displays correctly”.
- Test Plan presence: `## Test Plan` is present.
- Test Plan cardinality: 5 Completion Criteria items match 5 Test Plan rows (`TC-01`–`TC-05`).
- Test Plan detail: every row has a non-empty Test Type and Tool / Approach and contains no `TBD`.
- Manual-test justification: N/A — no Test Plan row uses `manual`.
- Tasks structure: `## Tasks` contains the required not-yet-created task placeholder.
- Evidence structure: `## Evidence Log` was empty before this first GATE-WRITE run.
- Forbidden body sections: no `## Status` or `## Classification` section is present.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-15

**Status upgrade:** review-ready → approved

- Ordering: the document is in `.agents/spec-docs/backlog/`, declares `status: review-ready`, and its
  Evidence Log contains a specific `GATE-WRITE` PASS dated 2026-08-15.
- Explicit authorization: in the current INFRA-100 approval exchange, the user stated verbatim,
  “내가 승인하는게 아니라 근거가 타당하면 너가 알아서 승인하고 넘어가야지.” This directly
  authorizes implementation once the stated evidence is independently found sound.
- Authorization condition: the focused stock-toolchain command reproduced exactly the seven remaining
  failures described by the plan (six Bash execution-witness failures and one BSD `date` interval
  failure; 52 tests passed), establishing that the portability premise is real rather than speculative.
- Decision authority: the chosen change is confined to existing internal harness implementation and
  its tests, preserves the existing witness/parser and child-process contracts, changes no public API,
  ownership, dependency direction, module boundary, root policy file, or novel repository practice, and
  is reversible with low blast radius. The user's delegated approval condition is therefore satisfied.
- Post-authorization integrity: the reviewed Architecture Review and frontmatter type/tags are unchanged
  at this gate run; the pre-entry document blob was
  `840f2fe43e0c0dcc2542cc345f36dcee660867ab`.
- Independent architecture validation: N/A — the spec introduces no package, app, public surface,
  interface surface, layer reclassification, or product-family boundary.
- Premature implementation check: no diff exists from the initiative base for any INFRA-100 affected
  implementation or test file, so the gate's pre-implementation authorization boundary was preserved.

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-15

**Status remains:** approved
**Failed criteria:**

- Task file: `.agents/tasks/INFRA-100-macos-harness-portability.md` does not exist, so no executable
  task breakdown corresponding to `TC-01` through `TC-05` is available.
  **Required action:** Create `.agents/tasks/INFRA-100-macos-harness-portability.md` with at least one
  task for each completion criterion and a substantive `## Test Plan` (or equivalent) section.
- Spec task pointer: `## Tasks` still records the task as `미생성` rather than naming an existing active
  task file.
  **Required action:** Replace the placeholder with the exact active task path after creating the task.
- Completion-criterion correspondence: without a task file, the gate cannot verify one task per TC-N.
  **Required action:** Map `TC-01` through `TC-05` explicitly in the task checklist.
- Task-level test plan: without a task file, the required task-level testing section of at least 50
  characters is absent.
  **Required action:** Add the focused witness, lock, temp-root, full harness, and scoped scenario
  verification commands to the task's testing section.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-15

**Status upgrade:** approved → in-progress

- Task file: `.agents/tasks/INFRA-100-macos-harness-portability.md` exists with active `status: todo`.
- Spec task pointer: `## Tasks` names the exact active task path and no longer marks it as uncreated.
- Completion-criterion correspondence: the task checklist contains five explicit work items mapped
  one-to-one to `TC-01` through `TC-05`: Bash 3.2 witness evidence, Node-owned lock timing, scoped
  canonical `TMPDIR`, the complete harness-test tier, and the provider-replay scenario verification.
- Task-level test plan: `## Test Plan` contains a substantive plan covering the focused witness and
  lock Vitest suites, `harness-scripts.test.mjs`, the complete harness directory through
  `harness:verify`, and the exact scoped `--include-scenarios` command without a caller-supplied
  `TMPDIR` override.
- Premature implementation non-compliance: N/A — the affected INFRA-100 implementation and test files
  still have no diff from the initiative base; the task artifact was created before implementation.

### [GATE-VERIFY] — ✅ PASS | 2026-08-15

**Status upgrade:** in-progress → verifying

- Ordering: the active document declares `status: in-progress`, and its Evidence Log contains a
  specific `GATE-IMPLEMENT` PASS dated 2026-08-15.
- Task completion: `.agents/tasks/INFRA-100-macos-harness-portability.md` exists with all five
  `TC-01`–`TC-05` plan items checked; `## Blockers` says `None`, and no unchecked task remains.
- Build: `volta run --node 22.14.0 pnpm harness:verify -- --scope
packages/agent-provider-replay --include-scenarios` ran without a caller-provided `TMPDIR` and
  exited 0; its root `pnpm build` completed all nine dependency tiers, including the affected
  `agent-session` and `agent-provider-replay` packages.
- Tests: the focused execution-witness, worktree-lock, and temp-root run passed 145/145; the same
  scoped harness command passed the complete repository harness tier (186 files, 3364/3364 tests)
  and `agent-provider-replay` tests (2 files, 8/8 tests). It also completed dependent typecheck,
  package typecheck, lint with 0 errors and 9 warnings, and matched
  `examples/scenarios/external-payload-replay.record.json` exactly.

### [GATE-COMPLETE] — ❌ FAIL | 2026-08-15

**Status remains:** verifying
**Failed criteria:**

- Per-criterion completion evidence: TC-01 through TC-05 are checked, but the Evidence Log contains no
  `[GATE-COMPLETE: TC-01]` through `[GATE-COMPLETE: TC-05]` entries recording each exact verification
  command/action, observed result, and exit code.
  **Required action:** Add one criterion-specific GATE-COMPLETE evidence entry for each of TC-01 through
  TC-05 with the exact command/action, actual observed result, exit code, and its test reference.
- Test Plan traceability: all five Test Plan Notes cells are blank, so none records a test file plus
  test/describe name or an explicit automated-test skip reason. This remains missing even though an
  independent focused run of the three named harness test files exited 0 with 3/3 files and 145/145
  tests passing.
  **Required action:** Update every TC-01 through TC-05 Test Plan row with the concrete test path and
  test/describe name, or an explicit skip reason where the criterion is command-verified rather than
  represented by an automated test.

- Satisfied structural checks: all Completion Criteria checkboxes and all active-task plan checkboxes
  are `[x]`; the spec names the exact active task path; the task exists, reports `Blockers: None`, and is
  completion-ready. User Execution Scenarios are explicitly N/A because this is repository-internal
  harness infrastructure. A changeset is N/A for the INFRA-100 diff because it changes repository
  harness scripts/tests and planning artifacts only, not a publishable package; the unrelated package
  changes in the shared initiative worktree are outside this gate.

### [GATE-COMPLETE: TC-01] — ✅ SATISFIED | 2026-08-15

- Command: `volta run --node 22.14.0 pnpm exec vitest run scripts/harness/__tests__/check-regression-red-proof-execution-witness.test.mjs scripts/harness/__tests__/worktrees-share-the-stash.test.mjs scripts/harness/__tests__/harness-scripts.test.mjs --pool=threads --maxWorkers=2 --testTimeout=30000`.
- Observed result: the exact `bash execution witness` and `witnessOneCase wiring` groups record only
  executed branches, reach function and subshell lines, preserve stderr, and remain inert without the
  trace environment; the file passed 37/37 within the 145/145 focused run.
- Exit code: 0.
- Test reference: `scripts/harness/__tests__/check-regression-red-proof-execution-witness.test.mjs > bash execution witness` and `witnessOneCase wiring`.

### [GATE-COMPLETE: TC-02] — ✅ SATISFIED | 2026-08-15

- Command: `volta run --node 22.14.0 pnpm exec vitest run scripts/harness/__tests__/check-regression-red-proof-execution-witness.test.mjs scripts/harness/__tests__/worktrees-share-the-stash.test.mjs scripts/harness/__tests__/harness-scripts.test.mjs --pool=threads --maxWorkers=2 --testTimeout=30000`.
- Observed result: the hermetic `flock` fixture proves locked non-overlap, its unwrapped control proves
  overlap, and the file passed 23/23 without host `flock` or GNU `date`.
- Exit code: 0.
- Test reference: `scripts/harness/__tests__/worktrees-share-the-stash.test.mjs > a worktree does not share its neighbour lint-staged backup`.

### [GATE-COMPLETE: TC-03] — ✅ SATISFIED | 2026-08-15

- Command: `volta run --node 22.14.0 pnpm exec vitest run scripts/harness/__tests__/check-regression-red-proof-execution-witness.test.mjs scripts/harness/__tests__/worktrees-share-the-stash.test.mjs scripts/harness/__tests__/harness-scripts.test.mjs --pool=threads --maxWorkers=2 --testTimeout=30000`.
- Observed result: `harness-tests` receives `realpathSync(tmpdir())`, another repository check keeps an
  empty environment projection, and the file passed 85/85.
- Exit code: 0.
- Test reference: `scripts/harness/__tests__/harness-scripts.test.mjs > repository-check ownership > canonicalizes only the complete harness-test temp root`.

### [GATE-COMPLETE: TC-04] — ✅ SATISFIED | 2026-08-15

- Command: `volta run --node 22.14.0 pnpm harness:verify -- --scope packages/agent-provider-replay --include-scenarios` with no caller-provided `TMPDIR`.
- Observed result: the integration gate ran the complete repository harness directory and passed 186
  files with 3364/3364 tests, followed by the nine-tier build and scoped checks.
- Exit code: 0.
- Test reference: command-only integration criterion; the exact complete-directory child command is
  stated in TC-04 and its observed result is independently recorded by GATE-VERIFY.

### [GATE-COMPLETE: TC-05] — ✅ SATISFIED | 2026-08-15

- Command: `volta run --node 22.14.0 pnpm harness:verify -- --scope packages/agent-provider-replay --include-scenarios`.
- Observed result: provider-replay passed 8/8 tests, lint with zero errors, typecheck, and the
  package-owned scenario output matched `external-payload-replay.record.json` exactly.
- Exit code: 0.
- Test reference: command-owned process scenario at
  `packages/agent-provider-replay/examples/verify-session-log-external-payload-replay.ts` with record
  `packages/agent-provider-replay/examples/scenarios/external-payload-replay.record.json`.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-15

**Status upgrade:** verifying → done

- Ordering: the active spec declares `status: verifying`, and its Evidence Log contains the specific
  `GATE-VERIFY` PASS dated 2026-08-15 with the full build, test, lint, typecheck, and scenario result.
- Completion Criteria: TC-01 through TC-05 are all checked, and each has a matching
  `[GATE-COMPLETE: TC-N]` entry with its exact command/action, observed result, exit code 0, and test
  reference or explicit command-only integration reason.
- Test Plan traceability: all five rows now record a concrete test file and test/describe name, or for
  TC-04 and TC-05 an explicit command-only reason tied to the exact gate command and scenario owner.
- Independent verification: the focused execution-witness, worktree-lock, and environment-projection
  command was independently reproduced at this gate and exited 0 with 3/3 files and 145/145 tests; the
  prior independent GATE-VERIFY entry records the exact complete scoped command exiting 0 with 186
  harness files, 3364/3364 harness tests, 8/8 provider-replay tests, and an exact scenario-record match.
- Task readiness: the spec names `.agents/tasks/INFRA-100-macos-harness-portability.md`; that active task
  exists, all five plan items are checked, `## Blockers` is `None`, and no pending item remains.
- User Execution Scenarios: N/A is explicit and substantiated because this change affects only
  repository-internal harness infrastructure and exposes no shipped user surface.
- Changeset applicability: N/A — INFRA-100 changes harness scripts/tests and planning artifacts only,
  not a publishable package; unrelated package changes in the shared initiative worktree are outside
  this gate.
