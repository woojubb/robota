---
status: done
type: INFRA
tags: [typescript]
---

# INFRA-092: Declaration Build Must Follow the Complete Workspace Type Graph

## Problem

`pnpm build` runs JavaScript builds for all packages and then `scripts/build-types-ordered.mjs` to
generate declarations. The scheduler claims strict topological order but reads only each package's
`dependencies`. Packages whose declaration inputs are workspace `devDependencies`,
`peerDependencies`, or `optionalDependencies` are therefore assigned before their inputs.

On the current tree, `@robota-sdk/agent-cli` has no recognized production dependency and is placed
in Tier 1 even though its TypeScript sources import 23 buildable `@robota-sdk/*` packages declared as
`devDependencies`. After the JavaScript pass cleans prior declaration output, Tier 1 executes
`agent-cli build:types` before its declaration inputs and fails. The same command succeeds after its
workspace declaration inputs have been built. This repeatedly blocked the pre-push gate for
RUNTIME-003.

## Prior Art Research

Research date: 2026-08-13. Official pnpm, npm, TypeScript, and build-graph documentation was
cross-checked against the reproduced clean-build failure and the current
`scripts/build-types-ordered.mjs` implementation.

- pnpm recursive execution topologically sorts workspace packages by default, with dependencies
  before dependents, and bounds concurrent workspace tasks. Its filtering documentation
  distinguishes `--filter-prod` precisely by saying that it omits `devDependencies`; ordinary
  workspace dependency selection therefore includes development relationships rather than
  equating the workspace graph with only the `dependencies` field. See
  [pnpm recursive execution](https://pnpm.io/cli/recursive) and
  [pnpm filtering](https://pnpm.io/filtering#--filter-prod-filtering_pattern).
- npm defines `devDependencies` as packages needed for local development/testing and explicitly
  documents build tooling as a `devDependency` use case. Thus a declaration-generation task may
  legitimately require a workspace package listed only there. npm defines `peerDependencies`
  separately as a compatibility relationship with a host; when a local peer's exported types are
  build inputs, its declarations must also exist first. See
  [npm dependencies and devDependencies](https://docs.npmjs.com/specifying-dependencies-and-devdependencies-in-a-package-json-file/)
  and [npm package.json fields](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#devdependencies).
- TypeScript documents the artifact relationship behind the failure: a dependent project consumes
  declaration output from referenced projects, ordinary `tsc` does not build dependencies
  automatically, and `tsc --build` discovers and orders referenced projects. See
  [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html#build-mode-for-typescript).
- Build-graph tools distinguish project edges from scheduled tasks and run dependency builds before
  dependents while retaining parallelism between independent nodes. Nx documents this as
  `dependsOn: ["^build"]`. See [Nx task pipelines](https://nx.dev/docs/concepts/task-pipeline-configuration).

The measured repository graph supports this model. Merging all four local workspace dependency
fields moves `agent-cli` from Tier 1 to Tier 9 and remains acyclic. The current graph includes three
buildable local `optionalDependencies` edges, so excluding that field would make the word “complete”
false even though it would happen to fix `agent-cli`. The complete graph explains the cold/root-build
failure and warm standalone success.

## Architecture Review

### Affected Scope

- Root build orchestration:
  - `scripts/build-types-ordered.mjs`
  - `package.json` root `build` contract (command unchanged)
- Deterministic graph tests:
  - `scripts/harness/__tests__/build-types-ordered.test.mjs` (new)
- Verification owner documentation:
  - `.agents/specs/verification-pipeline-plan.md`

### Alternatives Considered

1. **Move `agent-cli` workspace entries into `dependencies`.**
   - Pro: the current scheduler would happen to order this package correctly.
   - Con: corrupts install-time package semantics to compensate for an orchestrator defect and
     leaves every future dev-only/peer type input exposed.
2. **Replace the scheduler now with pnpm recursive execution or TypeScript project references.**
   - Pro: delegates graph scheduling to a documented owner.
   - Con: project references require a broad migration from the current `tsdown --dts` and
     `composite: false` setup; replacing the pnpm-8-era behavior needs wider compatibility proof.
3. **Merge local workspace dependency fields in the existing scheduler.**
   - Pro: repairs the graph at its owner, preserves the existing tier-ordered commands, and covers
     every local workspace dependency field that may supply declaration inputs.
   - Con: test-only edges may serialize more work, and a local peer cycle becomes an explicit build
     cycle requiring resolution rather than being silently ignored.
4. **Keep dependency-only ordering and require callers to prebuild.**
   - Pro: no code change.
   - Con: preserves a clean-root-build failure and makes success depend on stale artifacts.

### Decision

Choose alternative 3. For every package with `build:types`, the scheduler derives a deduplicated
local declaration prerequisite set from `dependencies`, `devDependencies`, `peerDependencies`, and
`optionalDependencies`. External names and workspace packages without `build:types` remain outside
the scheduled graph, as today. Package names, prerequisite names, tiers, and cycle diagnostics are
sorted so filesystem enumeration order cannot change the plan or its output. The existing
tier-by-tier execution and fail-closed cycle report remain.

Despite its current `runParallel` name, the implementation wraps `execSync` and therefore executes a
tier serially. INFRA-092 does not silently broaden into a process-execution refactor: it preserves that
behavior and renames the helper to describe it honestly. True bounded parallel execution is a separate
performance concern that needs its own failure handling and resource-budget design.

Validation before implementation: the real workspace was evaluated with the proposed relation; it
produces nine acyclic tiers and places `agent-cli` in Tier 9. Reachability covers all 75 packages that
currently declare `build:types` and the root `pnpm build` caller. The adversarial cases are duplicate
field declarations, external and non-buildable names, cross-field cycles, packages with only
dev/peer/optional workspace inputs, and permuted discovery order. Tests exercise each rather than
asserting a package name token exists.

### Structural Analog and Placement

The exact structural analog is the existing root repository-infrastructure module family under
`scripts/harness/*.mjs`. In particular, `scripts/harness/check-plan.mjs` and
`scripts/harness/scan-build-tooling-scope.mjs` both export pure functions for co-located harness
tests while retaining direct command execution. Their tests import those helpers through
repository-relative paths; no workspace package or application consumes them as a product API.

Package discovery reuses `scripts/harness/workspace-packages.mjs#listManifestPackageDirs`, the
existing SSOT for manifest-owning directories under `packages/**`, including nested package groups
and canonical exclusions. INFRA-092 owns only buildability filtering and declaration edges; it does
not create a second filesystem walker.

`scripts/build-types-ordered.mjs` belongs to that same root INFRA/developer-workflow family. The
root package is `private`, has no package `exports`, and already owns the workspace-wide build
entrypoint. Exporting graph discovery and tier calculation functions therefore creates only an
internal deterministic-test seam, not a shipped CLI, SDK, application, or reusable sibling-product
surface. The implementation continues to depend only on Node built-ins and workspace manifest
data. It does not import, wrap, filter through, or otherwise depend on any package or application
product API.

This placement reuses the lowest existing owner directly: the root build script remains the sole
declaration-task graph owner, and its co-located harness tests exercise the same pure relation used
by direct execution. Creating a workspace package for this logic, or importing a sibling product
factory, would introduce a dependency boundary that the existing root harness analog does not need.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `check-plan.mjs` and `scan-build-tooling-scope.mjs` provide the exact
      root-private ESM helper-export/test analog; packages and apps do not consume that seam
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Export pure workspace-package discovery and tier calculation functions from
   `build-types-ordered.mjs`; preserve direct-execution behavior behind a main-module guard.
2. Build each package edge set from the union of local `dependencies`, `devDependencies`,
   `peerDependencies`, and `optionalDependencies`, deduplicated and sorted before topology
   calculation.
3. Add reverse-direction fixtures proving each dependency field creates an edge, duplicates do not
   duplicate edges, irrelevant packages do not block, merged-field cycles fail with waiting details,
   input permutations produce identical tiers/diagnostics, and the live `agent-cli` graph is not
   Tier 1.
4. Run the root two-pass build from the post-fix tree and retain the existing package-owned
   `build:types` commands and tier-by-tier serial execution.

## Affected Files

- `scripts/build-types-ordered.mjs`
- `scripts/harness/__tests__/build-types-ordered.test.mjs`
- `.agents/specs/verification-pipeline-plan.md`

## Completion Criteria

- [x] TC-01: A fixture with local workspace edges in each of `dependencies`, `devDependencies`,
      `peerDependencies`, and `optionalDependencies` places every dependency before its consumer;
      duplicate field declarations produce one edge.
- [x] TC-02: External packages and workspace packages without `build:types` do not block the graph;
      a cross-field cycle exits non-zero and names every remaining package and waiting edge.
- [x] TC-03: The live workspace topology contains all 75 packages with `build:types`, places
      `@robota-sdk/agent-cli` after each buildable local declaration input, and never places it in
      Tier 1; permuting discovery input produces identical tiers and cycle diagnostics.
- [x] TC-04: `pnpm build` exits 0 from the final tree without manually prebuilding `agent-cli` or
      relying on a second retry.
- [x] TC-05: The verification pipeline owner describes the complete four-field local workspace
      declaration graph, deterministic tier order, current serial tier execution, and fail-closed
      cycle behavior.

## Test Plan

| TC-ID | Test Type         | Tool / Approach                                                                                                                                               | Notes                                                 |
| ----- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| TC-01 | INFRA unit        | `scripts/harness/__tests__/build-types-ordered.test.mjs` > `orders and deduplicates local prerequisites from every dependency field`                          | Covers all four fields and deduplication              |
| TC-02 | INFRA unit        | Same file > `ignores external and non-buildable names and reports cross-field cycles deterministically`                                                       | Asserts actionable cycle detail                       |
| TC-03 | INFRA integration | Same file > `covers the live declaration graph and keeps agent-cli after all local prerequisites`; `produces the same sorted tiers for every discovery order` | Covers 75 packages and deterministic Tier 9 placement |
| TC-04 | CI smoke          | `pnpm build` (engineering command; no separate automated test)                                                                                                | Cold two-pass root build contract                     |
| TC-05 | Governance        | `node scripts/harness/scan-harness-script-import-safety.mjs`; owner-doc review (engineering checks)                                                           | Verifies import safety and owner-document claim       |

## User Execution Test Scenarios

**Applicability:** not-applicable

This item changes only repository-internal declaration-build scheduling. It does not alter a shipped
Robota CLI, application, transport, or public SDK behavior. Root build output is engineering
verification and, by the backlog-execution rule, cannot be repackaged as user-execution evidence.

## Tasks

- [x] `.agents/tasks/completed/INFRA-092-declaration-build-workspace-topology.md`

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-08-13

Independent review found the problem, prior art, alternatives, decision, completion criteria, test
plan, and not-applicable user-scenario classification otherwise complete. The draft was returned
because exporting pure graph functions creates a module/interface seam, while the Architecture
Review did not identify its closest structural analog, product-family classification, or dependency
proof. Required correction: classify the seam, name the existing repository analog, and prove that
it does not introduce sibling-product coupling before re-review.

### [GATE-WRITE] — ✅ PASS | 2026-08-13

**Status upgrade:** draft → review-ready

- Frontmatter: YAML delimiters, `status: draft`, allowed `type: INFRA`, and `tags: [typescript]` were
  present at gate input.
- Problem: identifies the failing `pnpm build` declaration phase, Tier 1 `agent-cli` ordering, the
  cold-build reproduction condition, and the successful prerequisite-built comparison.
- Prior Art Research: cites pnpm, npm, TypeScript, and Nx documentation and carries their
  dependency/task-graph findings into the alternatives and selected complete-workspace-edge decision.
- Architecture placement: classifies the exported seam as root-private INFRA/developer-workflow
  infrastructure, identifies the existing `scan-build-tooling-scope.mjs` helper-export,
  co-located-test, direct-execution analog, and confirms no sibling package or application product
  dependency is introduced.
- Completion Criteria and Test Plan: TC-01 through TC-05 are concrete, observable, and map exactly
  to five populated test-plan rows.
- Structure: Tasks contains the pre-approval placeholder, and the prior failed gate is retained for
  audit history.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-13

- Owner approval (verbatim): “타당한 이유와 함께 추천안을 제시하면 타당할 경우 자동으로
  승인하겠습니다”.
- The INFRA-092 recommendation builds declaration order from the deduplicated union of local
  workspace `dependencies`, `devDependencies`, and `peerDependencies`, retaining the existing
  root-private scheduler and established helper-export/co-located-test structure.
- The owner's condition became true when the corrected final recommendation received independent
  GATE-WRITE PASS, including verification of the nine-tier graph, `agent-cli` Tier 9 placement,
  structural analog, INFRA classification, and absence of sibling-product coupling.
- No post-approval drift occurred in Architecture Review or frontmatter `type`/`tags`.
- A separate architecture-placement verdict is not applicable because no package, app, shipped
  interface, reusable product surface, or layer/product-family boundary is introduced.
- No implementation began before approval; the scheduler still reads only `dependencies`.

### [RECOMMENDATION REVIEW] — ❌ REVISE | 2026-08-13

- The graph-owner placement and existing scheduler strategy were endorsed in direction, but the
  recommendation understated the live graph and overstated the executor.
- Required corrections: use the measured 75 `build:types` packages; include the three current
  buildable local `optionalDependencies` edges in the complete relation; stop describing the
  `execSync` implementation as parallel; and sort graph/output data with permutation tests.
- Depth review: `DEPTH: LOCAL` — the task targets the scheduler's incomplete edge model itself rather
  than patching the `agent-cli` symptom (`0 FOUNDATIONAL of 1`).

### [RECOMMENDATION RE-REVIEW] — ❌ REVISE | 2026-08-13

- The corrected four-field graph, measured package count, deterministic ordering, test plan, and
  root-private placement were accepted in substance.
- One factual contradiction remained: the Problem called the Tier 1 execution concurrent while the
  Decision correctly documented the current `execSync` tier executor as serial. The Problem was
  corrected to state that `agent-cli` runs before its declaration inputs.

### [RECOMMENDATION FINAL REVIEW] — ✅ ENDORSE | 2026-08-13

- Independent review confirmed the measured scope of 75 packages declaring `build:types`.
- The selected relation is the sorted, deduplicated union of all four local dependency fields and
  includes the three current buildable local optional edges.
- The reproduced graph has nine acyclic tiers and places `@robota-sdk/agent-cli` in Tier 9 after all
  of its buildable local declaration inputs.
- Deterministic package, prerequisite, tier, and cycle-diagnostic ordering is covered by permuted
  fixture inputs.
- The recommendation preserves the existing serial `execSync` executor and keeps true process
  parallelism outside this correctness task.
- Root-private placement and the pure helper/main-guard test seam introduce no product coupling.

**REVIEW VERDICT: ENDORSE**

### [OWNER CONDITIONAL APPROVAL — CORRECTED SCOPE] — ✅ PASS | 2026-08-13

- Owner instruction: “타당한 이유와 함께 추천안을 제시하면 타당할 경우 자동으로
  승인하겠습니다”.
- The material correction from three to four dependency fields was not inferred as silently covered
  by the earlier approval. It was independently re-reviewed after the measured optional edges,
  package count, deterministic ordering, and serial execution semantics were added.
- The owner's stated condition became true when that corrected recommendation received
  `REVIEW VERDICT: ENDORSE`; implementation approval therefore applies to this final four-field
  recommendation.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-13

**Status upgrade:** approved → in-progress

- Ordering: the Evidence Log contains a prior `GATE-APPROVAL` PASS, and the document entered this
  gate with `status: approved` in the expected `todo` lifecycle folder.
- Tasks artifact: `.agents/tasks/INFRA-092-declaration-build-workspace-topology.md` exists and is
  named exactly in this spec's `## Tasks` section.
- TC-01 task: model and deduplicate all four workspace dependency fields.
- TC-02 task: ignore irrelevant nodes and fail closed with deterministic cycle details.
- TC-03 task: cover all 75 live declaration packages and keep `agent-cli` after its local inputs.
- TC-04 task: pass a clean root `pnpm build` without a preparatory retry.
- TC-05 task: synchronize the verification pipeline owner document.
- Test-plan requirement: the task artifact contains a substantive `## Test Plan` describing the TDD
  sequence and focused, live-topology, root-build, harness-scan, and CI-equivalent verification.

### [GATE-VERIFY] — ✅ PASS | 2026-08-13

**Status upgrade:** in-progress → verifying

- Task completion: `.agents/tasks/INFRA-092-declaration-build-workspace-topology.md` exists; TC-01
  through TC-05 are all marked `[x]`, its Blockers section is `None`, and it contains no unchecked,
  blocked, or pending task.
- Build verification: independently ran `pnpm build`; it exited 0 after building the package JavaScript
  pass and all 75 `build:types` packages across nine deterministic tiers, ending with
  `✓ All build:types complete.`
- Test verification: independently ran `pnpm test`; it exited 0 across the recursive workspace test
  run (`Scope: 102 of 103 workspace projects`), including the terminal package result
  `packages/agent-cli test: Done`.

### [GATE-COMPLETE: TC-01] — ✅ VERIFIED | 2026-08-13

- Command: `pnpm exec vitest run scripts/harness/__tests__/build-types-ordered.test.mjs`.
- Result: exit 0; `orders and deduplicates local prerequisites from every dependency field` passed,
  proving four-field ordering and deduplication.

### [GATE-COMPLETE: TC-02] — ✅ VERIFIED | 2026-08-13

- Command: `pnpm exec vitest run scripts/harness/__tests__/build-types-ordered.test.mjs`.
- Result: exit 0; the irrelevant-node/cross-field-cycle test passed with deterministic waiting-edge
  diagnostics, and the discovery test excluded a package without `build:types`.

### [GATE-COMPLETE: TC-03] — ✅ VERIFIED | 2026-08-13

- Command: `pnpm exec vitest run scripts/harness/__tests__/build-types-ordered.test.mjs`.
- Result: exit 0; 5/5 tests passed. The live graph contained 75 packages in nine tiers,
  `@robota-sdk/agent-cli` was Tier 9, and all of its local inputs preceded it. Permuted fixtures
  produced identical tiers and cycle diagnostics.

### [GATE-COMPLETE: TC-04] — ✅ VERIFIED | 2026-08-13

- Command: `pnpm build`.
- Result: exit 0 on the first final-tree run without a preparatory package build or retry; all 75
  declaration packages completed across nine tiers and the command ended `✓ All build:types complete.`
- Test disposition: no separate automated test; the root build command is the authoritative
  engineering smoke and was also rerun independently by GATE-VERIFY.

### [GATE-COMPLETE: TC-05] — ✅ VERIFIED | 2026-08-13

- Commands/actions: reviewed `.agents/specs/verification-pipeline-plan.md`; ran
  `node scripts/harness/scan-harness-script-import-safety.mjs` and `pnpm harness:verify-like-ci`.
- Result: import-safety scan exited 0 after examining 152 harness scripts; the owner document states
  the four-field `packages/**` graph, deterministic tier/cycle ordering, serial execution, and
  fail-closed cycles; verify-like-CI passed all 11 stages in 7m58.6s.
- Test disposition: governance claims are covered by the import-safety scan, owner-doc inspection,
  and the CI-equivalent engineering gate rather than a product test.

### [GATE-COMPLETE EVIDENCE SUMMARY] — READY | 2026-08-13

- TC-01 through TC-05 are checked and each has exact verification output plus a test reference or
  explicit engineering-test disposition.
- The active task is completion-ready with every plan item checked and no blockers.
- User-execution applicability remains `not-applicable` because no shipped product surface changed.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-13

**Status upgrade:** verifying → done

- Ordering: the Evidence Log contains a prior `GATE-VERIFY` PASS, and the document entered this gate
  with `status: verifying` in the expected `active` lifecycle folder.
- TC-01: checked; its evidence records the exact focused Vitest command, exit 0, and the named test
  proving four-field prerequisite ordering and deduplication.
- TC-02: checked; its evidence records the same exact command, exit 0, and the named tests proving
  irrelevant-node exclusion plus deterministic cross-field cycle diagnostics.
- TC-03: checked; its evidence records exit 0 and 5/5 focused tests. Independent gate execution
  reconfirmed 75 declaration packages, nine tiers, `agent-cli` in Tier 9, and all 23 local inputs in
  earlier tiers.
- TC-04: checked; its evidence records the authoritative `pnpm build` action, first-run exit 0, and
  the explicit reason no separate automated test is used for this engineering smoke contract.
- TC-05: checked; its evidence records owner-document inspection, the exact import-safety and
  CI-equivalent commands, exit-0/pass results, and the explicit governance-test disposition.
- Test Plan: all five rows name a test file and test case or give an explicit engineering-check
  disposition; no TC is silently unaddressed.
- Task readiness: `.agents/tasks/INFRA-092-declaration-build-workspace-topology.md` is the exact active
  path named by the spec, exists, has TC-01 through TC-05 checked, reports `None` under Blockers, and
  contains no pending task.
- Independent recheck: the focused test file passed 5/5 with exit 0, import-safety passed for 152
  scripts with exit 0, and live graph inspection returned
  `{"packages":75,"tiers":9,"agentCliTier":9,"agentCliInputs":23}`.
