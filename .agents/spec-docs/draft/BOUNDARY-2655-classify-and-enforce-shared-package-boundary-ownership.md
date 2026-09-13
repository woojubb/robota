---
status: draft
type: INFRA
tags: [typescript]
lane: L2
---

# BOUNDARY-2655: Classify and enforce shared package boundary ownership

Canonical draft resumed after PR #2717 landed at `38e87a027c530dbbe11beae9a62bc6732f65ca59`. This is not an approved executable checkpoint. Canonical existing Task: `.agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md`. Scope remains all of Issue #2490 transferred to Issue #2655.

## Problem

The current workspace import analysis extracts literal module specifiers but resolves only workspace package names. Relative cross-package imports, JSON/config references and file/data consumers are absent from its evidence. Its package-level sets discard the consuming file, target file and reference kind. A missing edge is not proof of zero consumers.

Concrete ownership leak: `packages/agent-cli/scripts/record-goal-cassette.mts` imports the framework's internal goal cassette fixture, which is also consumed by its framework replay test. These are two files in two packages but one framework-specific recording/replay scenario, not two independent demands for a neutral shared API. The recording tool also refers to the retired `agent-provider-defaults` package.

Read-only actual planner observations on the current checkout:

- `node scripts/harness/workspace-affected.mjs --operation test --changed-file vitest.shared.ts`: global; reason `workspace-wide input changed: vitest.shared.ts`.
- Same command for the framework goal fixture: packages mode, framework only.
- Same command for the CLI recording script: packages mode, CLI only.

These are selected plans, not executed tests or proof of a missing test fanout. Moving the tool has an ownership benefit; no reduced package selection count is claimed.

## Inventory Preparation Evidence

Current read-only AST diagnostic at `38e87a027c530dbbe11beae9a62bc6732f65ca59`: 8,584 tracked paths,
8,572 regular files and 12 symlinks excluded from content reads; 4,186 JS/TS sources contain
18,185 literal module references, 21 nonliteral module expressions and 3,079 named workspace
references. Resolving tracked relative source imports identifies 38 cross-owner references:
32 imports of root Vitest configuration, three CLI imports of artifact tooling, one CLI import
of the framework goal fixture, and two artifact tests importing DAG build configurations.
This diagnostic does not resolve every alias, emitted artifact, config/data or dynamic reference;
it is a bounded baseline, not completed classification or final graph coverage. Earlier counts
below are historical observations and must not be substituted for this current population.

Carson's read-only index enumeration reported 8,582 tracked paths: 8,570 regular files and 12 symlinks not followed; 4,185 JS/TS files. Declared workspace roots: 109 (82 packages, 10 apps, 16 examples, one scratch). This enumerates tracked names with current working-file contents, not an immutable committed-content snapshot and not completed semantic classification.

Retain candidates with identified consumers: agent-process `killProcessTree` (executor, tools, subagent-runner) and `DEFAULT_KILL_GRACE_MS` (executor, subagent-runner); remote-pairing `extractDtlsFingerprint` (webrtc, webrtc-web). These are symbol-level findings, not blanket neutrality approval of their entire packages. Repository-tool ownership separately covers `vitest.shared.ts` (33 directly importing workspaces) and the common artifact assembler (82 package build commands).

Additional real migration candidates:

- Four `scripts/examples/hook-*-demo.mjs` scenarios use agent-core's hook behavior and belong with its scenario owner, subject to registration/path updates and preserved executable examples.
- `scripts/migrate-session-history.mjs` and `scripts/__tests__/migrate-session-history.test.ts` implement session-specific messages-to-history migration. Main confirmed the owning `packages/agent-session/docs/SPEC.md` explicitly documents this root command. Proposed owner: agent-session tooling; validate historical schema and all invocations before moving it. Never execute this migration against the user's real home/session directory during verification; use explicitly injected ordinary temporary data with no HOME override.
- `packages/agent-testing/package.json` is currently `private: true` despite public-looking publishConfig and conflicting SPEC prose. Its PTY exports have one external workspace consumer (transport-tui, three files). Resolve the actual contract/disposition before moving or deleting that package; current private status alone does not prove it was never published.

Root harness/external-proof fixtures remain repository-tool data unless evidence establishes a product-package owner. Names such as shared/helper are not themselves migration grounds.

Main inspected the session migration test runner: it currently substitutes `HOME` in the child process environment and invokes a cwd-relative root script. Do not run that existing runner during this task. The owner migration should inject an explicit session-directory argument into its callable implementation and test that argument with ordinary temporary data, leaving the production default and historical conversion behavior explicit. This avoids repurposing a system home variable and removes cwd-dependent test invocation. The hook examples import `agent-core/dist/node/index.js`; the timeout example also reads a source path for the timeout constant. Moving these files requires updating both runtime import and source-inspection paths, not only their filenames.

## Prior Art Research

The prior-art worker compared three official product-documentation pages (no implementation source):

- [Nx module boundaries](https://nx.dev/docs/features/enforce-module-boundaries) declares allowed dependency directions through project tags. Its shared-to-shared constraint is useful precedent, but a tag is not evidence of semantic neutrality.
- [Turborepo boundaries](https://turborepo.dev/docs/reference/boundaries) checks workspace boundary violations and documents the feature as experimental. Do not treat it as a complete semantic classifier or introduce it as a second graph.
- [Turborepo run](https://turborepo.dev/docs/reference/run) distinguishes affected selection, dry-run planning and run summaries. The worker also observed explicit input-sensitive affected configuration; the main browser's full-page fetch was unavailable, so implementation must not depend on unverified flag behavior.

Recommendation: extend the existing Robota analysis with explicit ownership constraints and observed references, and keep planned/selected/executed/cache information distinct in its existing reporting. The two-independent-package-consumer threshold is Robota's user-defined acceptance criterion, not a standard asserted by these external tools. Research supports the design direction, not completion of the repository-wide classification or permission to delete public APIs.

## Architecture Review

### Affected Scope

- Existing graph discovery: `scripts/harness/workspace-graph.mjs`.
- Existing source/reference analysis: `scripts/harness/workspace-source-dependencies.mjs`.
- Existing selection/reporting: `workspace-affected-plan.mjs`, `workspace-operation-selection.mjs`, `workspace-plan-shapes.mjs`, and their existing execution/cache consumers where evidence requires changes.
- Existing focused workspace-affected tests.
- Framework-owned goal recording tool, fixture/replay references and framework SPEC; exact manifests and injection regression placement require validation.
- Repository-wide retained shared classifications and any additional owner migrations identified by the complete inventory. This list is not final until that inventory is reconciled.

### Alternatives Considered

1. Extend the current reference-analysis owner and add an owned semantic classification contract over its evidence. Pro: one graph/selection/reporting path; exposes missing coverage. Con: resolution and classification need distinct mechanical and semantic verification.
2. Introduce an independent shared-file scanner/graph and blanket root-to-package moves. Pro: isolated implementation. Con: duplicated resolution, missed data edges and false ownership from path naming; rejected.

### Decision

Proposed alternative 1, pending consumer and adversarial validation. Keep measured references separate from semantic ownership decisions. Inventory the complete tracked source/config/data population within declared workspace roots and root tooling, explicitly accounting for generated/vendor exclusions and unresolved references. Do not use a helper filename regex as the whole population.

For every shared candidate, record the owner/API, independent package consumers, neutrality rationale and retained/migrate decision. Root repository tooling is separately owned infrastructure, not a public shared product API. A public package contract cannot be deleted solely because its internal consumer count is low; verify its actual published constraints and redesign only through the appropriate contract route.

Extend existing analysis with source file, target, reference kind, owner and resolved/unresolved state. Cover literal relative imports (including emitted `.js` to source resolution), aliases where declared, JSON configuration inheritance and literal file/URL references. Dynamic references must be explicitly unresolved unless a bounded declared input resolves them. Never silently report them as absent consumers.

Project only justified edges into existing operation selection and input/cache ownership. Retain the current explicit global-promotion policy for unknown/global inputs; report the actual reason. A reference is not automatic justification for reverse-testing every consumer. Distinguish planned, selected, executed, skipped and full-promoted coverage in the existing output path; do not add a parallel CI planner.

First concrete migration: move the framework goal recording tool from CLI scripts into framework-owned non-published tooling. Keep the fixture, goal objective, iteration budget and cassette in framework. Inject the current public provider factory into the existing recording harness. Validate that a tooling-only composition root and devDependency are outside the framework runtime's concrete-provider restriction; do not silently create an exception. Preserve cassette bytes and do not run paid live recording by default.

### Architecture Review Checklist

- [ ] 영향 패키지/레이어 목록 작성 완료
- [ ] Sibling scan 완료 — complete population and existing boundary gates still being reconciled
- [x] 대안 최소 2개 검토 완료
- [ ] 결정 근거 문서화 완료 — proposed design awaits complete consumer/adversarial validation

## Fallback & Degradation Declaration

No new silent fallback proposed. Preserve explicit global promotion with its reason for unresolved verification inputs. Unknown ownership is not a successful boundary classification.

## Classification Contract To Validate

Use three distinct decisions rather than confusing all public package APIs with generic helpers:

- **Domain-owned public API:** an implementation/contract belongs to its declared package, even
  when used by another package. Inspect its owner contract and allowed dependency direction;
  do not delete a forward-provisioned public surface because an in-repo caller count is low.
- **Retained generic shared material:** reusable helpers, fixtures or data offered across owners
  need a declared neutral API and at least two independently justified package consumers. A
  public barrel alone, two files in one package or recording/replay of one scenario does not prove this.
- **Owner-local material / repository infrastructure:** move package-specific content to its
  owner; retain genuinely repository-wide build/test machinery with explicit consuming targets
  and input roles. Root placement is not an automatic exemption from examination.

Every tracked file must have a population disposition (analyzed source/config/data, documentation,
asset, generated/vendor, symlink or other explicitly described category). Every candidate's
semantic decision must link concrete source references and its owner contract. Dynamic or
unresolved inputs stay visible with their bounded declarations; zero references is not evidence
that analysis covered them. The independent reviewer must validate this distinction against the
source Issue and the existing Forward-Provisioned Surface Rule before approving the design.

## Solution

One complete ownership work unit: inventory and classifications, real owner migrations, drift enforcement using the existing analysis, and truthful selection/execution reporting. A report-only implementation or a gate with no migrations does not satisfy the source issue.

## Affected Files

Existing owners to extend, not parallel replacements:

- `scripts/harness/workspace-source-dependencies.mjs`, `workspace-graph.mjs`,
  `workspace-affected-plan.mjs`, `workspace-execution-plan.mjs`,
  `workspace-execution-engine.mjs`, `workspace-plan-shapes.mjs` and focused tests.
- A boundary policy/classification record and an automatically discovered scan under
  `scripts/harness/`; schema, reference evidence and graph projection have distinct ownership.
  No new root script, CI workflow or alternate workspace graph is proposed.
- Framework/CLI goal recording and fixture ownership, four agent-core hook examples and
  agent-session migration tooling/tests plus current documented invocations.
- The private agent-testing PTY implementation/tests and transport-tui consumers, subject to the
  validated contract disposition. Package-specific manifests/lockfile and SPEC/README/project
  structure references must follow the final migration set. Public contracts are not silently removed.

## Completion Criteria

- [ ] TC-01: Full tracked population is reconciled to declared workspace roots and repository tooling; every excluded class has an explicit reason, every unresolved reference is visible, and every shared candidate has a reviewed disposition.
- [ ] TC-02: Retained shared files have an owned, domain-neutral API and at least two independently justified package consumers; same-scenario recording/replay or several files in one package do not inflate this evidence. Public contract dispositions are validated rather than guessed from internal counts.
- [ ] TC-03: All classified package-specific helpers, fixtures, constants and data are moved to their owners, with old cross-owner internal references removed and runtime/record-replay behavior preserved. Includes the known framework goal recording tool, not only a registry entry.
- [ ] TC-04: Existing reference analysis and drift gate reject missing owners, stale/missing consumer evidence, invalid shared retention and newly introduced ownership leaks; aliases, relative imports, config/data refs and unresolved dynamic cases have positive/negative regressions.
- [ ] TC-05: Existing affected selection and cache inputs consume consistent justified references; output distinguishes selected versus executed coverage and states every global promotion reason, without a parallel graph or unjustified broad fanout.
- [ ] TC-06: Focused regressions, affected package checks and current remote CI verify the complete changed scope. Parent/source issue completion is reconciled only after all criteria land on origin/develop.

## Test Plan

| TC-ID | Test Type                       | Tool / Approach                                                                                            | Notes                                                                                                          |
| ----- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| TC-01 | Integration and semantic review | Inventory over the actual tracked checkout plus independent review of complete dispositions                | A parser count alone cannot establish neutrality or independence; no full-population result is claimed yet.    |
| TC-02 | Unit and semantic review        | Positive/negative retained-shared cases and API/consumer evidence review                                   | Public external consumers must not be inferred absent from a local search.                                     |
| TC-03 | Integration                     | Framework goal cassette replay and scripted session tests; offline recording provider-injection regression | No live key or cassette regeneration for a move-only check. Test paths/manifest composition still to validate. |
| TC-04 | Unit/integration                | Extend existing workspace affected/reference test owner with ordinary-file/in-memory fixtures              | No local worktrees, clones or Git fixture repositories.                                                        |
| TC-05 | Integration                     | Existing affected planner/executor/cache reporting tests with selected, skipped, failed and global cases   | The three observed CLI plans above are baseline evidence, not final verification.                              |
| TC-06 | CI smoke                        | Actual affected checks and remote CI on final head, then per-criterion merge audit                         | No reuse of unrelated green jobs as whole-scope proof.                                                         |

## User Execution Test Scenarios

Pending final command-surface decision before gate submission. The original ownership-only Task recorded N/A, but the newly confirmed documented session migration command and executable hook examples require explicit runnable scenarios if moved. Do not preserve a blanket N/A after changing a documented command path.

Required draft scenarios: offline recording/replay with injected provider; hook examples at their new documented paths; session migration against isolated injected fixture storage, including repeated invocation and malformed/unchanged records. No test may discover or mutate the user's real session directory. Preserve or explicitly migrate old documented entry points in the approved design; do not leave stale instructions.

## Tasks

- [ ] `.agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` — todo

## Validation Findings Before Approval

Nash's depth triage identifies a FOUNDATIONAL class already owned by this Task: package-name
reference sets omit the evidence needed for ownership and input decisions. The Task itself already
covers the cause; no symptom-only patch or duplicate Task is proposed. The triage does not claim
that the observed cassette leak caused broad CI fan-out; a performance claim needs before/after evidence.

The framework SPEC explicitly keeps functional feature verification in the framework and forbids
concrete provider imports. Moving the replay into CLI would violate that ownership. Moving the
live recorder into framework tooling therefore needs a validated non-published composition boundary
or actual provider injection; the draft must not silently authorize a dependency-direction exception.

Pascal found eight agent-testing exports and one external consuming package (transport-tui, three
files). The recorded CLI-077 disposition says the owner made never-published packages private;
current npm registry lookup is 404, which alone does not prove historical non-use. Proposed
relocation preserves the PTY implementation, six self-tests and actual transport behavior. The
old public-intent SPEC must be explicitly reconciled before removing the private package contract.
Do not execute the existing HOME-rebinding PTY/migration helpers locally as a planning check.

## Owner Decision Recommendation

The complete original objective remains required. These decisions concern which contract governs
the migration, not permission to substitute a report or a narrower gate for actual delivery:

1. Preserve owned, forward-provisioned public SDK surfaces under the existing project-structure
   rule; internal consumer count alone is not a deletion ground. Apply the two-independent-package
   retention test to generic shared implementation/test material, while still inventorying public
   API ownership and dependency directions. This interpretation requires owner confirmation rather
   than silently excluding public surfaces from the source Issue's wording.
2. Relocate the currently private, recorded-never-published agent-testing PTY implementation and
   six self-tests into transport-tui's internal test support; preserve behavior, migrate all three
   consuming files and explicit devDependencies, and remove the now-empty private package only
   under this disposition. This replaces the old published-intent SPEC, not a deployed public API.
3. Permit concrete provider composition only in the framework's non-published cassette-recording
   development tool, using the current provider factory as an explicit development dependency.
   Keep runtime and exported testing APIs provider-injected and unchanged, and keep replay and
   fixture data in the framework. This is the smaller alternative to adding a generic cross-package
   scenario plugin/proxy system solely to pass a provider through one recording command. The
   existing broad provider-import prohibition must be amended explicitly if this option is approved.

No such contract/placement change is implemented by this draft. Existing recorded replay remains
the offline verification route; no paid recording or cassette-byte rewrite is implied. The PTY
relocation must preserve its isolation behavior; do not simply remove HOME isolation to run locally.
The current local HOME-rebinding restriction is reported separately from CI verification rather than
starting a repository-wide user-path injection redesign inside this ownership task.

## Evidence Log
