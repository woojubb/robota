---
status: done
completed: 2026-09-13
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

Retain candidates with identified consumers: agent-process `killProcessTree` (executor, tools, subagent-runner) and `DEFAULT_KILL_GRACE_MS` (executor, subagent-runner); remote-pairing `extractDtlsFingerprint` (webrtc, webrtc-web). These are symbol-level findings, not blanket neutrality approval of their entire packages. Repository-tool ownership separately covers `vitest.shared.ts` (32 direct importers at the current baseline) and the common artifact assembler (82 package build commands).

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

**Delivery mode:** `single`

Choose alternative 1 under the owner's three approved recommendations recorded below; independent adversarial validation remains pending. Keep measured references separate from semantic ownership decisions. Inventory the complete tracked source/config/data population within declared workspace roots and root tooling, explicitly accounting for generated/vendor exclusions and unresolved references. Do not use a helper filename regex as the whole population.

For every shared candidate, record the owner/API, independent package consumers, neutrality rationale and retained/migrate decision. Root repository tooling is separately owned infrastructure, not a public shared product API. A public package contract cannot be deleted solely because its internal consumer count is low; verify its actual published constraints and redesign only through the appropriate contract route.

Extend existing analysis with source file, target, reference kind, owner and resolved/unresolved state. Cover literal relative imports (including emitted `.js` to source resolution), aliases where declared, JSON configuration inheritance and literal file/URL references. Dynamic references must be explicitly unresolved unless a bounded declared input resolves them. Never silently report them as absent consumers.

Project only justified edges into existing operation selection and input/cache ownership. Preserve explicit global promotion for invalid registry structure, unreadable change inputs and control-plane changes. A well-formed unresolved runtime input instead makes its affected test entry conservatively selected and non-cacheable; it does not invalidate other entries. Report the actual reason and uncertain population. A reference is not automatic justification for reverse-testing every consumer. Distinguish planned, selected, executed, skipped and full-promoted coverage in the existing output path; do not add a parallel CI planner.

First concrete migration: move the framework goal recording tool from CLI scripts into framework-owned non-published tooling. Keep the fixture, goal objective, iteration budget and cassette in framework. Inject the provider created by the current public factory into the existing recording harness. The owner approved the tooling-only composition root and devDependency exception; amend its governing contract explicitly and verify runtime/published reachability remains provider-neutral. Preserve cassette bytes and do not run paid live recording by default.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — existing analysis/tooling owners and concrete migration owners below; further evidence-backed moves remain within TC-03
- [x] Sibling scan 완료 — existing workspace graph/source analysis, workspace-import-integrity scan and owner-local examples/scripts/test-support placements inspected; complete semantic population classification remains delivery TC-01
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료 — one analysis owner preserves evidence without duplicating graph/selection; independent adversarial verdict remains explicitly pending

## Fallback & Degradation Declaration

No silent fallback is permitted. Global uncertainty preserves complete promotion with its reason.
Entry-local unresolved runtime inputs preserve their diagnostics and force that test to run without
cache reuse when no narrower safe scope has been proved. Unknown ownership or unknown consumer
evidence needed for a shared-retention decision is not a successful boundary classification.

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

### Reference evidence and projection contract

The existing source-analysis owner holds extraction/resolution. Reuse `lib/ts-ast.mjs`, already
used by `scan-workspace-import-integrity`, rather than introducing another compiler stack.
The inventory consumes tracked regular paths without following symlinks and the existing graph's
workspace roots. Keep these three distinct record shapes:

```text
Ownership { path, owner, category, contractEvidence }
Reference { source, span, kind, specifier, context,
  resolution: resolved(targets, evidenceInputs) | external | builtin | unresolved(reason) }
ProjectedInput { targetOrPattern, sensitivity, referenceIds }
```

Reference kinds distinguish module, execute, read-content, list-names and config. Context records
production/verification/tooling and type-only module references. Input sensitivity distinguishes
execution closure, content and name-set changes. Resolve target owners from ownership records,
not a duplicated owner field whose value can drift. Shared decisions additionally record the
neutrality rationale, independently justified consumer package identities and concrete reference
IDs. Resolution inputs include manifests and alias/config files: a changed mapping invalidates
the old resolution. Ambiguous mappings and nonliteral expressions remain explicit diagnostics;
bounded declarations supply exact input semantics rather than claiming arbitrary code is statically
resolvable. Missing/stale declarations and new unclassified cross-owner references fail the scan.

`readWorkspaceImportDependencies` derives its existing production/verification sets from this
evidence. `readWorkspaceGraph` remains the sole package graph and preserves manifest, copied
artifact and verification-prerequisite edges. `selectPackagesForOperation` keeps the existing
fanout policy; ownership evidence alone never creates reverse-test fanout.

Artifact compatibility: the default graph retains full Git-backed tracked/nonignored input
analysis and propagates collection errors. Ordinary root builds explicitly request filesystem
inventory from the same source-inventory owner, preserving full source/config resolution without
requiring Git metadata. This is a selected input mode, never a fallback after a Git failure.
Filesystem inventory records its own provenance rather than claiming tracked/untracked coverage;
it never follows symlinks or traverses dependency storage, `.git`, or declared generated outputs.
Metadata-only artifact consumers may explicitly disable source analysis while retaining manifest,
capability, copied-producer and manifest/copy-cycle validation. The graph reports source analysis
as not performed, distinct from a performed empty result, and such a projection cannot be used
for operation scheduling. Root/affected build regressions continue to analyze actual fixture
source files and preserve copied ordering, exact payloads and failure recovery without Git fixtures.

For root contract tests, `contract-test-inputs.mjs` currently has a second regex relative closure
and treats every quoted executable-looking filename as executable. Replace that inference in
`relativeImportClosure`/`createContractTestRegistry` with the same typed reference evidence.
`createAffectedContractPlan` and `createContractTestCacheKey` consume the same projected input
semantics, with a cache-schema change where the key meaning changes. Name enumeration hashes
the matching path set; content reads hash bytes; execution traverses the justified closure.
Do not equate a broad directory literal with a content dependency on every product source file.
Preserve explicit complete/global promotion on global uncertainty and its actual reason. Well-formed
entry-local unresolved inputs instead force conservative selection and disable both cache reads and
writes for that entry. Do not infer a safe input scope merely from its source package location.
Report the counts of uncertain/always-run and cacheable entries; renaming almost-full execution is
not performance improvement evidence. Existing
execution result owners distinguish selected, cache-hit, executed, failed and not-run outcomes;
planned tasks and cached results are never reported as newly executed tests.

Regressions cover fake imports in comments/string data, emitted-source and exports/alias mapping,
ambiguous mappings, symlink non-traversal, content versus name-set sensitivity, newly added files,
entry-local uncertainty versus global promotion, preserved copied edges and cache-hit/non-execution reporting. Tests use
in-memory or ordinary-file fixtures, not auxiliary Git repositories.

### Engineering refinement after measured integration

On 2026-09-13, integration found 1,000 distinct unresolved runtime expressions affecting 234 of
266 contract-test entries. The original Issue #2490 requires repository-wide ownership decisions,
actual moves, a boundary gate and truthful affected/full execution reporting, not exhaustive runtime
argument interpretation. The first implementation conflated unresolved evidence with malformed
registry structure and promoted all entries. Main corrected that engineering overreach under the
owner's standing direction to remove unnecessary work and improve obstructive harness rules.
Hume independently recommended entry-local conservative execution and selective, evidence-backed
owner input contracts instead of a new interprocedural analyzer or 1,000 individual exceptions.
The policy above is an explicit revision, not a claim that earlier global-promotion wording already
specified this behavior. Earlier approval/gate evidence remains historical and unchanged. Public SDK
protection, the two-independent-consumer criterion, all owner-local migrations and ownership drift
checks are unchanged. Final review must assess this revised policy and actual selection counts.

### Owner-local moves

- Move the four `scripts/examples/hook-*-demo.mjs` files to
  `packages/agent-core/examples/` with the same basenames. Resolve runtime imports to the
  owner's `../dist/node/index.js`; the timeout example resolves its source inspection relative
  to `import.meta.url`, not the caller's cwd. Update executable usage comments and current
  documentation; historical completed-work records stay historical. The examples remain local
  development tools, not new public SDK exports.
- Move the session migration command to
  `packages/agent-session/scripts/migrate-session-history.mjs` and its tests into that owner's
  test tree. Add an explicit `--sessions-dir <absolute-directory>` CLI input and a callable
  implementation taking that directory; retain the no-argument production default. Reject
  invalid/unknown arguments before reading storage. The documented command migrates to the
  owner path without leaving a root forwarding implementation. Preserve existing message
  conversion, timestamps, nonempty-history skips, malformed-JSON skips and idempotence.
  Integration tests invoke the actual command by absolute path against ordinary temporary
  fixture storage; no HOME overrides or access to real session storage.
- Move the goal recorder to `packages/agent-framework/scripts/record-goal-cassette.mts`.
  Compose `createQwenProviderDefinition` from the public
  `@robota-sdk/agent-provider-openai-compatible` export, verified in `src/qwen/index.ts` and
  `src/qwen/provider-definition.ts`. A provider aggregator is unnecessary for this one-provider
  recording tool. Preserve its default model/base URL, key requirement and iteration budget;
  update relative fixture imports and recording instructions. An offline test injects the
  recording provider into the recording operation; this development seam is not an exported
  testing API. Keep the concrete factory solely at the executable composition root and make
  its dependency development-only. Verify that package exports and packed files cannot reach
  that root. Preserve the committed cassette byte-for-byte and dispose the harness on failure.
  Include the moved `.mts` tool in the owner's non-emitting development typecheck (the current
  `tsconfig.examples.json` includes only examples and source). Do not add it to tsdown entries:
  these remain `src/index.ts` and `src/testing/index.ts`, with only `dist` packaged.
- Move `agent-testing/src/pty/{spawn-pty,isolated-home}.ts` and the six PTY self-tests to
  `agent-transport-tui/src/__tests__/pty/`, preserving their exports internally and changing
  all three current consumers to relative imports. Move explicit `tsx` and
  `@homebridge/node-pty-prebuilt-multiarch` devDependencies. Remove the emptied private package
  under the approved disposition; update lockfile, current package inventory and architecture
  references. Existing HOME-isolated PTY behavior is preserved, not executed locally by this
  task. Actual owning CI results, not a local test claim, must verify those tests.

These package moves use the existing owner-local examples/scripts/test-support analogs rather
than a new shared package. The framework provider exception must be written into the governing
SPEC before its implementation and checked against published/runtime reachability. Additional
migrations follow the same approved classification criterion only when concrete inventory
evidence establishes the owner; unresolved decisions are not silently marked retained.

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

2026-09-13 local acceptance reconciliation: the two process API decisions, exact tooling/config
dispositions, drift regressions and conservative input/cache reporting are verified in the paired
Task's final local integration evidence. The earlier `extractDtlsFingerprint` candidate is retained
as a domain-owned public pairing/channel-binding API: its owner SPEC declares it, the public
barrel exports it, and the Node WebRTC transport and browser RTC client consume it. It is not a
generic shared API or an alias exception, so no artificial fourth alias registry row is required.
Final-head remote PTY/HOME and CI results are now recorded in the paired Task's closeout evidence
and the per-TC handoff below. Local scanner zero alone does not establish semantic classification
of unknown file kinds. Hume's initial missing-owner-record FAIL is preserved in the paired Task;
his subsequent MERGE VERIFIED PASS and the read-back owner comment now supply verified landing.

- [x] TC-01: Full tracked population is reconciled to declared workspace roots and repository tooling; every excluded class has an explicit reason, every unresolved reference is visible, and every shared candidate has a reviewed disposition. Evidence: paired Task final population reconciliation and bounded supplement, with exact original unknown-path fingerprint and the additional owned SDP sample.
- [x] TC-02: Retained shared files have an owned, domain-neutral API and at least two independently justified package consumers; same-scenario recording/replay or several files in one package do not inflate this evidence. Public contract dispositions are validated rather than guessed from internal counts. Evidence: local acceptance reconciliation above and paired Task final local integration.
- [x] TC-03: All classified package-specific helpers, fixtures, constants and data are moved to their owners, with old cross-owner internal references removed and runtime/record-replay behavior preserved. Includes the known framework goal recording tool, not only a registry entry. Evidence: paired Task owner-local migration/scenario results and final-head build/TUI runtime evidence below.
- [x] TC-04: Existing reference analysis and drift gate reject missing owners, stale/missing consumer evidence, invalid shared retention and newly introduced ownership leaks; aliases, relative imports, config/data refs and unresolved dynamic cases have positive/negative regressions. Evidence: paired Task final local integration and independently accepted scanner/wiring regressions.
- [x] TC-05: Existing affected selection and cache inputs consume consistent justified references; output distinguishes selected versus executed coverage and states every global promotion reason, without a parallel graph or unjustified broad fanout. Evidence: paired Task final local integration, typed registry validation and cache/projection/execution reporting regressions.
- [x] TC-06: Focused regressions, affected package checks and current remote CI verify the complete changed scope. Parent/source issue completion is reconciled only after all criteria land on origin/develop. Evidence: exact-head CI and Hume's revalidated MERGE VERIFIED PASS below; Main owns the subsequent parent/source projection.

## Test Plan

| TC-ID | Test Type                              | Test written: exact file and test/describe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Evidence boundary                                                                                                                                                                                                                      |
| ----- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Integration and semantic review        | `scripts/harness/__tests__/workspace-source-inventory.test.mjs` > `accounts for every tracked path without reading symlinks or pending deletions`; `reports nonignored untracked additions separately while resolving both populations`; `links ownership to present declarations without inventing contracts or shared validity`                                                                                                                                                                                                                                                                                                                                       | The paired Task's complete population reconciliation and independently reviewed dispositions are additional semantic evidence, not inferred from parser counts.                                                                        |
| TC-02 | Unit and semantic review               | `scripts/harness/__tests__/scan-package-boundary-ownership.test.mjs` > `package boundary ownership` > `requires actual references from two different package owners, not two files`; `accepts public source aliases and protects domain APIs without applying the neutral-consumer threshold`                                                                                                                                                                                                                                                                                                                                                                           | Two process APIs, exact tooling/config dispositions and protected public APIs have distinct acceptance rules. Local caller counts do not disprove external public consumers.                                                           |
| TC-03 | Owner-local integration and remote PTY | `packages/agent-core/src/__tests__/owned-hook-examples.test.ts` > `owner-local hook commands`; `packages/agent-session/src/__tests__/migrate-session-history.test.ts` > `migrate-session-history`; `packages/agent-framework/scripts/__tests__/record-goal-cassette.test.ts` > `records an injected offline provider through the real goal loop and replays its cassette`; `packages/agent-framework/scripts/__tests__/goal-cassette-replay-example.test.ts` > `runs the public SDK replay example without changing the committed cassette`; `packages/agent-transport-tui/src/__tests__/pty/spawn-pty.test.ts` > `spawnPty harness self-test` and `PTY HOME isolation` | Additional migrated contract/data cases are listed below. Offline recording/replay did not use live keys. Final-head remote helper 6/6, handoff 2/2 + 1/1 and TUI 32/32 close the former local PTY execution boundary.                 |
| TC-04 | Unit/integration                       | `scripts/harness/__tests__/workspace-source-dependencies.test.mjs` > `workspace source reference evidence`; `scripts/harness/__tests__/scan-package-boundary-ownership.test.mjs` > `package boundary ownership`; `scripts/harness/__tests__/package-boundary-ownership-wiring.test.mjs` > `discovers the actual non-advisory boundary command without adding a legacy runner duplicate`                                                                                                                                                                                                                                                                                 | Existing extraction/graph/scan owners are reused; positive/negative ordinary-file/in-memory regressions do not require local Git fixtures.                                                                                             |
| TC-05 | Selection/cache/reporting integration  | `scripts/harness/__tests__/contract-projected-selection.test.mjs` > `selects an explicitly resolved content consumer across owner boundaries`; `scripts/harness/__tests__/contract-test-cache.test.mjs` > `content-addressed contract-test cache`; `scripts/harness/__tests__/contract-execution-reporting.test.mjs` > `returns truthful coverage from the actual tier orchestration path`; `scripts/harness/__tests__/contract-execution-coverage.test.mjs` > `distinguishes cache reuse, invoked shards and tests never invoked after failure`                                                                                                                        | Typed content/name-set/execution semantics and entry-local noncacheability are tested. Final CI explicitly promoted for a control-plane input, not an asserted efficiency gain.                                                        |
| TC-06 | Actual CI and delivery audit           | `scripts/harness/__tests__/artifact-ci-framework-proof.test.mjs` > `ARTIFACT clean framework proof CI wiring` > `the current source graph really selects 16 including recorder, replay and analytics producers, without global fallback`; actual CI commands and remote identities below                                                                                                                                                                                                                                                                                                                                                                                | The automated wiring test does not replace actual clean build/affected tests or independent landing verification. No new automated test for the external owner-landing comment: Hume's API-backed revalidation PASS is recorded below. |

Additional TC-03 owner-local regressions: `packages/agent-builtin-providers/src/deepseek-provider-demo.test.ts`

> `verifies real offline definitions/composition and reports a catalog mismatch as failure`;
> `packages/agent-core/src/__tests__/role-model-contract.test.ts`
> `SELFHOST-006 TC-05 — neutral role-model contract`;
> `packages/agent-remote-pairing/src/__tests__/fingerprint-parity.test.ts`
> `DTLS fingerprint extraction parity (REMOTE-009 D6)` (four preserved assertions);
> `packages/dag-cli/src/__tests__/doctor-version.test.ts` > `doctor owner-local version`.
> Remote consumer coverage includes `packages/agent-transport-tui/src/__tests__/command-handoff-pty-e2e.test.ts`
> `command handoff PTY E2E` and `packages/agent-transport-tui/src/__tests__/terminal-handoff-pty-e2e.test.ts`
> `terminal handoff PTY E2E`. The original browser-native fixture remains with its RTC consumer;
> the pairing-owned dialect sample introduces no generic shared fixture API.

## User Execution Test Scenarios

The paired Task owns six authored, automatable scenarios and their exact prerequisites, commands,
observables, cleanup and recorded direct execution evidence. Main executed all six owner-local
examples with exit 0 and matching observables; the Task retains Hume's independent
DONE-GATE-STAGE-2 PASS dated 2026-09-13. The earlier author probes remain historical preparation,
not substitutes for the new-path executions. The implementation includes
two bounded owner-local examples: `packages/agent-session/examples/verify-session-history-migration.mjs`
and `packages/agent-framework/examples/verify-goal-cassette-replay.mts`. They invoke the real command
or existing public SDK and report actual results; they do not duplicate product algorithms.

The canonical entries below project the existing Task scenarios without changing their commands,
expectations or recorded results. The Task remains the authoring and execution-evidence owner;
this format repair does not record a new scenario run or gate verdict.

**Author verdict:** `SCENARIO DRAFTED: automatable | 6`

### Scenario 1: Relocated hook blocking example

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-core`. Relocate `hook-block-demo.mjs` to this package's `examples/` and point its import at the owning package output. The current agent-core artifact and a POSIX shell must be available. The destructive-looking `tool_input.command` is inert input data; execute only the example's harmless configured hook that prints a reason and exits 2, never that tool-input string.
- command: `node examples/hook-block-demo.mjs`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=runHooks returns blocked=true and reason="Bash tool blocked: dangerous command detected" Comparison: Capture the actual `runHooks result` JSON and exit 0. The example's later manually assembled `IToolResult` and its PASS prose do not prove PermissionEnforcer or AI delivery behavior.
- cleanup: No scenario files are created; allow the short hook child to exit.
- evidence: 2026-09-13 direct owner-local command exited 0; actual runHooks result was blocked=true with reason="Bash tool blocked: dangerous command detected" and empty stdout. Illustrative tool-result prose was not substituted for the SDK return.

### Scenario 2: Relocated JSON hook responses

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-core`. Relocate `hook-json-response-demo.mjs`, correct the owning output import, and use the same current agent-core artifact and local shell. Its three hook commands only print JSON.
- command: `node examples/hook-json-response-demo.mjs`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=stopReason blocks with Security policy violation; PreToolUse returns permissionDecision=deny; systemMessage returns blocked=false and stdout="User has elevated permissions today." Comparison: Compare all three actual returned objects printed by the example and require exit 0; do not substitute its summary string for the returned values.
- cleanup: No persistent files or services; hook children exit normally.
- evidence: 2026-09-13 direct owner-local command exited 0; actual results were blocked=true/reason="Security policy violation", blocked=true/permissionDecision="deny", then blocked=false/stdout="User has elevated permissions today.".

### Scenario 3: Relocated permission-mode stdin forwarding

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-core`. Relocate `hook-permission-mode-demo.mjs`, correct the owner import, and make Node available on PATH for the child that reads hook JSON from stdin. No user settings are seeded.
- command: `node examples/hook-permission-mode-demo.mjs`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=hook stdout is "default" then "bypassPermissions", with blocked=false for both invocations Comparison: Capture both child stdout values and exit 0. These strings verify forwarding only; the scenario does not change the verifier's own permission posture.
- cleanup: No scenario files; both stdin-reading children exit.
- evidence: 2026-09-13 direct owner-local command exited 0; child stdout was "default" then "bypassPermissions", and blocked=false for both results. No verifier permission setting was changed.

### Scenario 4: Relocated timeout example with explicit runtime outcomes

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-core`. Relocate `hook-timeout-demo.mjs`, correct both its owning output import and command-executor source lookup. Use a POSIX shell with `sleep`; no long wait is required.
- command: `node examples/hook-timeout-demo.mjs`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=timeout:1 returns blocked=false with errors containing kind=timeout; timeout:5 returns blocked=false with stdout containing "hook completed" Comparison: Capture both actual result objects, exit 0 and the existing elapsed-time checks (first below 1800ms; second at least 1800ms and below 4000ms). A slow host failure must be reported, not silently retried into a PASS. Reading DEFAULT_TIMEOUT_SECONDS=600 is source inspection, not evidence that a default-duration command executed; the old "exit code 1" description is not the current timeout outcome contract. Preserve and observe the explicit timeout diagnostic.
- cleanup: Let the short sleep children finish; no persistent data is created.
- evidence: 2026-09-13 direct owner-local command exited 0; timeout:1 returned blocked=false with errors[0].kind="timeout" at 1007ms; timeout:5 returned blocked=false/stdout="hook completed" at 2019ms. Both elapsed bounds matched; the inspected default constant was not runtime evidence.

### Scenario 5: Session migration on explicitly injected disposable data

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-session`. Move the real command to `scripts/migrate-session-history.mjs` and implement `--sessions-dir <absolute-directory>` before running this example. The example creates one ordinary `mkdtemp` directory under the OS temporary directory, obtains its absolute path and seeds four JSON files: legacy messages (user "hello", assistant "world", fixed valid updatedAt `2026-01-01T00:00:00Z`), existing nonempty history, empty messages, and malformed JSON. Add one non-JSON sentinel. Keep original bytes for comparison. No fixture contains credentials or uses the real sessions directory; no HOME, USERPROFILE or other global-home override is permitted.
- command: `node examples/verify-session-history-migration.mjs`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=first migration reports Migrated: 1, Skipped: 3, Total: 4; legacy history has two chat entries; second migration reports Migrated: 0, Skipped: 4, Total: 4 with unchanged bytes Comparison: The example invokes the real owner command with `execFileSync(process.execPath, [absoluteScriptPath, '--sessions-dir', absoluteFixtureDirectory])`, without a shell or environment override. Report captured command stdout plus the parsed migrated JSON: original messages remain, history types/data preserve user "hello" and assistant "world", each entry has a UUID and the fixed updatedAt timestamp. Existing history, empty-message JSON, malformed JSON and the non-JSON sentinel must remain byte-identical. Compare all bytes again after the second invocation. Also invoke the same command with an explicit missing child directory below the fixture root: observe `No sessions directory found.` and no directory creation. Do not execute the default path, even with `--help`: the old command ignores arguments and would discover the actual home directory. Emit a compact result containing the actual counts and entry values; assertion failure exits nonzero, but exit status alone is not the user evidence.
- cleanup: In `finally`, remove only the exact ordinary temporary directory created by this example; never derive a cleanup target from HOME, a workspace root or an unvalidated command argument.
- evidence: 2026-09-13 direct example exited 0; real command reported 1/3/4 then 0/4/4 migrated/skipped/total. Printed history retained user hello and assistant world with distinct UUIDs and timestamp 2026-01-01T00:00:00.000Z. Skipped/sentinel bytes and all repeat-run bytes matched; missing storage remained absent. Only the owned ordinary temporary fixture was removed.

### Scenario 6: Existing framework goal cassette replay, without recording

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-framework`. The new owner-local example uses the existing public `@robota-sdk/agent-framework/testing` scriptedSession API and the existing framework-owned `src/testing/__fixtures__/goal-cassette-fixture.ts` constants/objective. Dependencies and the current public package outputs must resolve. Read the existing cassette without modification; use `scriptedSession({ cassette: GOAL_CASSETTE_PATH, bare: true })`, which owns its ordinary temporary workspace and session-log directory. Do not import Vitest configuration, rebind HOME, load a concrete live provider, read keys or use record/toCassette mode.
- command: `pnpm exec tsx examples/verify-goal-cassette-replay.mts`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=goal.status=satisfied; goal.stopReason=satisfied; GOAL.txt contains "done"; tool calls include Bash and report_goal_status Comparison: Execute `runGoal(buildGoalObjective(harness.cwd), { maxIterations: GOAL_MAX_ITERATIONS })` and print the actual status, stopReason, GOAL.txt content and tool names before disposal. Assert the committed cassette bytes are unchanged. The recorder moves to `packages/agent-framework/scripts/record-goal-cassette.mts`, but this offline run proves preserved replay behavior, not successful live recording or the new concrete provider composition. Keep recorder import/dependency wiring verification in engineering evidence; no paid recording or committed cassette regeneration is authorized. The existing replay test remains in framework.
- cleanup: Always `await harness.dispose()` in `finally`; it removes only its owned temporary workspace after shutdown. Do not write to user settings or delete the committed cassette.
- evidence: 2026-09-13 direct pnpm exec tsx example exited 0 and printed status=satisfied, stopReason=satisfied, GOAL.txt=done, tool calls=Bash, report_goal_status. Disposal completed and the example's cassette-byte assertion passed; no live recording, credentials or HOME override was used.

## Tasks

- [x] `.agents/tasks/completed/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` — done

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

## Owner Approval — 2026-09-13

Direct user instruction, quoted verbatim: `모듀 승인함`.

In context this approves all three numbered recommendations immediately above: preserve
domain-owned public SDK surfaces while applying the independent-consumer criterion to generic
shared material; relocate and remove the private PTY package under its recorded disposition;
and explicitly amend the framework boundary for non-published cassette-recording composition
only. These decisions no longer await owner approval. Earlier pending-approval language records
the pre-approval investigation, not an additional approval requirement.

This approval does not claim proposal-reviewer ENDORSE, a gate PASS, implementation, verification,
or issue completion. Worktrees remain prohibited. Runtime provider injection, cassette bytes,
PTY isolation and the complete six-criterion delivery scope remain binding.

## Historical completion preparation

Author-only restoration, 2026-09-13: this pair is active again for the requested later-PR
continuation checkpoint preparation. Prior completion and verification entries retain their
actual dates, verdicts and observed results as historical evidence; they are not a new
continuation judgment or permission to archive on this branch. Hume owns the next named gate,
and Main owns the clean-pair checkpoint inventory and commit. The original v2 `single`
GATE-IMPLEMENT payload and Decision are unchanged; no sequenced predecessor is fabricated.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-13

**Status upgrade:** draft → review-ready

Independent guardian: Nash. This entry records GATE-WRITE only; the frontmatter and file location
remain unchanged for the orchestrator. GATE-WRITE is the entry gate and requires no predecessor.
The document was at `status: draft`, `lane: L2`, in the draft folder, with an empty Evidence Log
before this entry. The caller reported mechanical results of 20 PASS, 0 FAIL and 7
PENDING-GUARDIAN; this guardian inspected the document against all 27 catalogue criteria and did
not rerun that command or claim implementation/test results.

- GATE-WRITE — YAML frontmatter fence: PASS; the document begins with a closed `---` block.
- GATE-WRITE — Draft status: PASS; frontmatter records `status: draft`.
- GATE-WRITE — Allowed type: PASS; `type: INFRA` is one catalogue prefix.
- GATE-WRITE — Tags field: PASS; `tags: [typescript]` is present.
- GATE-WRITE — Concrete symptom: PASS; Problem identifies the CLI recorder's direct framework-internal fixture import and the package-name-only analysis that loses file/reference evidence. It explicitly does not claim this example caused measured broad CI fan-out.
- GATE-WRITE — Reproduction condition: PASS; Problem names the recorder/fixture paths and the existing affected-planner invocation with concrete changed-file inputs and observed global versus package selections. These are planning observations, not executed-test claims.
- GATE-WRITE — Problem completeness: PASS; the multi-paragraph Problem contains concrete behavior and no TBD/TODO placeholder.
- GATE-WRITE — Research section: PASS; `## Prior Art Research` is present.
- GATE-WRITE — Research documentation evidence: PASS; official Nx module-boundary and Turborepo boundaries/run documentation is cited, with experimental and semantic-classification limits stated.
- GATE-WRITE — Research waiver alternative: N/A; substantiated research is supplied, so no opt-out is used.
- GATE-WRITE — Research informs alternatives and decision: PASS; declared boundary constraints and separate planning/execution evidence support extending the existing owner; the competing parallel-graph alternative is explicitly rejected. The two-consumer threshold remains the owner's criterion, not an attributed external standard.
- GATE-WRITE — Architecture checklist completion: PASS; all four checklist items are checked with scope/evidence notes.
- GATE-WRITE — Sibling scan evidence: PASS; the checked item names the existing graph/source analysis, workspace-import-integrity scan and owner-local tooling/test-support patterns. Delivery-wide semantic classification remains TC-01, not a claimed completed sibling scan result.
- GATE-WRITE — Alternatives with trade-offs: PASS; two alternatives each state advantages and disadvantages.
- GATE-WRITE — Decision trade-off: PASS; one reference-analysis owner retains evidence without duplicating resolution/selection, accepting the need for separate mechanical and semantic validation.
- GATE-WRITE — Conditional surface placement: PASS for the writing criterion; the migrations identify existing package-local examples/scripts/test-support layers and classify them as development tooling or internal test support, not a new sibling product or public SDK surface. The framework recorder reuses the existing injected recording harness and an explicit provider-adapter composition root; runtime/testing exports remain injected and the tool remains outside emitted/packed entries. Agent-core's existing examples and transport-tui's existing internal test helpers provide concrete placement analogs. The provider-boundary exception and PTY disposition are explicit owner choices, not hidden exemptions. Independent architectural endorsement is still pending and is not supplied by this verdict.
- GATE-WRITE — TC prefixes: PASS; all six Completion Criteria use unique TC-01 through TC-06 identifiers.
- GATE-WRITE — Feature coverage by criteria: PASS; TC-01 covers the complete population, TC-02 retained API/consumer qualifications, TC-03 actual owner migrations, TC-04 drift rejection, TC-05 selection/cache/reporting and TC-06 complete-scope verification/landing. The four concrete migration groups remain obligations under TC-03.
- GATE-WRITE — Observable criteria: PASS; the criteria require reconciled dispositions, evidenced consumers, removed cross-owner internal references, rejected drift and reported scope/promotion outcomes. They do not substitute inventory counts or a passing checker for completed migrations.
- GATE-WRITE — Banned vague criterion language: PASS; none of the four catalogue-banned phrases occurs in the Completion Criteria.
- GATE-WRITE — Test Plan section: PASS; `## Test Plan` is present.
- GATE-WRITE — TC/Test Plan correspondence: PASS; exactly six rows map one-to-one to TC-01 through TC-06, with no omitted or additional TC identifier.
- GATE-WRITE — Test Type and Tool/Approach: PASS; every row supplies both fields without TBD, covering semantic review, focused ordinary-fixture regressions and actual remote verification.
- GATE-WRITE — Manual-only test rationale: N/A; no Tool/Approach cell is manual-only. Semantic review is explicitly paired with inventory or regression evidence rather than presented as execution.
- GATE-WRITE — Tasks linkage: PASS; the unchecked Tasks entry names the existing exact BOUNDARY-2655 Task path.
- GATE-WRITE — Initial Evidence Log: PASS; the section was present and empty when judged, before this append.
- GATE-WRITE — No duplicate status/classification sections: PASS; there is no exact `## Status` or `## Classification` body heading; `Classification Contract To Validate` describes the subject contract rather than duplicating frontmatter.

Scope boundary: the owner's `모듀 승인함` confirms the three recorded choices only. This entry is
not GATE-APPROVAL, proposal-reviewer ENDORSE, scenario-stage PASS, an implementation checkpoint or
completion evidence. The document explicitly leaves independent adversarial review and concrete
user-execution scenarios pending; those are not falsely counted as completed GATE-WRITE results.
No source edits, tests, Git fixtures, worktrees, clones or HOME overrides were performed.

Before returning this same gate invocation, the guardian also read the author's newly added
`Reference evidence and projection contract`. The PASS includes that latest content: ownership,
typed references and projected inputs have distinct roles; existing graph edges remain owned by
the existing graph; content, name-set and execution sensitivities feed both selection and cache;
mapping changes invalidate resolution; unresolved inputs retain explicit promotion reasons.
The existing AST helper and contract-input/cache entry points named by this addition were checked
for presence. These are design obligations, not verified runtime behavior. The addition reinforces
the decision and TC-04/TC-05 coverage without replacing the complete-population or migration criteria.
The binding below hashes the latest authored document before this guardian entry (the text through
the previously empty Evidence Log, with its terminal newline), not the earlier draft snapshot.

**Judged at:** HEAD `2b0b28ef1e3d1c0fbfd1fd30435dc5ebaa7325f6` · base `origin/develop@38e87a027c530dbbe11beae9a62bc6732f65ca59` · document `.agents/spec-docs/draft/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` blob `9b97fc9f27bee64f5cf6913d31bcff43f8c35e5b` (modified)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-13

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "모듀 승인함"
**Given:** 2026-09-13, this conversation
**Review fingerprint:** e51239ca6f6b (review 8e4e3131, type/tags 74b52707)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-13, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (e51239ca6f6b) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `2b0b28ef1e3d` · base `origin/develop@38e87a027c53` · document `.agents/spec-docs/backlog/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` blob `34f4f3502ed6` (modified)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-13

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "모듀 승인함"
**Given:** 2026-09-13, this conversation
**Review fingerprint:** e51239ca6f6b (review 8e4e3131, type/tags 74b52707)

Independent guardian: Nash. This is the semantic completion of this one GATE-APPROVAL invocation,
not another approval request or an implementation gate. The frontmatter remains `review-ready`
and the file remains in `backlog`; the orchestrator owns any advancement. The preceding mechanical
approval entry is preserved rather than presented as independent architectural endorsement.

- GATE-APPROVAL — Ordering: PASS; the recorded GATE-WRITE PASS names draft → review-ready, matching the current status and backlog location under the catalogue's recorded-pass rule.
- GATE-APPROVAL — User has provided explicit approval in the current conversation: PASS; the direct instruction `모듀 승인함` and its date are recorded, and the caller explicitly confirms it approves the three recommendations for this document.
- GATE-APPROVAL — Approval is direct and unambiguous for this spec: PASS; the instruction confirms the public-SDK/shared-material distinction, private PTY relocation/removal and non-published framework recording composition exception. It is not inferred from silence, approval of a different PR or a delegated class. The six original delivery criteria remain binding.
- GATE-APPROVAL — Named delegated class exists and predates approval: N/A; route DIRECT, not CLASS.
- GATE-APPROVAL — Class authorising instruction, date and session: N/A as a CLASS condition; the DIRECT instruction and this-conversation date are nevertheless recorded in the required form above.
- GATE-APPROVAL — Class evidence condition measured: N/A; no delegated-class evidence is claimed.
- GATE-APPROVAL — Item lies inside the registered class: N/A; no class is used to expand the direct approval.
- GATE-APPROVAL — Architecture Review and type/tags unchanged after approval: PASS; an independent read-only call to the existing `reviewFingerprint` returned review `8e4e3131`, type/tags `74b52707`, combined `e51239ca6f6b`, exactly matching the recorded approval fingerprint. This protects those fields, not an assertion that every document byte is frozen.
- GATE-APPROVAL — Independent architecture validation and placement: PASS; Hume's existing independent proposal review returned `REVIEW VERDICT: ENDORSE` on 2026-09-13, recorded in the exact paired Task's Test Plan. The caller supplied Hume's existing premise/code and placement evidence below; this guardian preserves that provenance rather than claiming to have rerun Hume's review. It expressly covers the latest single-analysis/graph contract, typed selection/cache projection and owner migrations including the non-published recorder boundary.
- GATE-APPROVAL — Premature implementation check: PASS within the inspected state; current changes are the Task/spec and planning/scenario ledgers, with no production-file changes. The recorded command probes use existing commands/artifacts, not the proposed relocated implementation. This verdict does not certify scenario execution or GATE-IMPLEMENT.

**Independent placement evidence — Hume, existing review, 2026-09-13:**

- Verdict: `REVIEW VERDICT: ENDORSE`. Hume reported no false premise, LOCAL design finding or separate root finding. Source record: `.agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md`, Test Plan; the additional detail here is the reviewer's existing evidence relayed by the caller in this conversation, not a new review by Nash.
- Reference-analysis premise: `scripts/harness/workspace-source-dependencies.mjs` — `extractLiteralModuleSpecifiers`, `importedWorkspaceNames` and `readWorkspaceImportDependencies` lose file/reference detail; `scripts/harness/contract-test-inputs.mjs` — `literalExecutableDependencies` and `relativeImportClosure` infer false executable edges from quoted filenames. The design repairs these existing owners rather than adding another graph.
- Reuse/projection premise: `scripts/harness/lib/ts-ast.mjs` and `scan-workspace-import-integrity.mjs` supply the existing AST stack; `workspace-graph.mjs` / `readWorkspaceGraph` retains current graph edges; `contract-selection-plan.mjs` / `createAffectedContractPlan` and `contract-test-cache.mjs` / `createContractTestCacheKey` consume registry inputs; `workspace-operation-selection.mjs` retains operation-specific fanout. Ownership evidence is not permission for automatic reverse-test fanout.
- Product-family/analog placement: hook demonstrations belong to agent-core examples, historical session conversion to agent-session tooling, goal recording/replay to framework development tooling and PTY support to transport-tui internal tests. These mirror existing package-local examples/scripts/test-support roles, not a new sibling application or public SDK product. Hume verified the hook-core API, session-owned conversion and the three named TUI test consumers within one package.
- Recorder boundary: Hume verified the existing private framework fixture, public `createQwenProviderDefinition` and `scriptedSession`'s `record.provider` seam. `packages/agent-framework/package.json` packages only `dist`; `tsdown.config.ts` has the two existing main/testing entries. This supports non-published tooling placement, with post-move export/runtime/packed reachability still required during implementation. Nash independently read those current manifest/config declarations and located the factory implementation; no build or pack execution is claimed.
- Contract disposition: Hume checked the Forward-Provisioned Surface Rule and the explicit framework SPEC exception against the owner-approved design. The PTY move preserves its behavior and real consumers under the approved private-package disposition; it does not pretend an unexamined public API may be deleted by caller count alone.
- Additional structure-channel output: N/A to introducing a new product/package/presentation surface; this work relocates existing owner-local tooling/test support and explicitly adjusts its development boundary. No architecture-audit-fanout run is claimed. The conditional boundary-placement review itself is supplied by Hume above, not waived.
- Limits: semantic classification of all 8,584 baseline paths, completed migrations, runtime reachability, CI verification and performance gains remain unproven delivery obligations. ENDORSE does not claim those outcomes. The independent scenario-stage result remains separately owned and is not advanced or overwritten here.

**Judged at:** HEAD `2b0b28ef1e3d1c0fbfd1fd30435dc5ebaa7325f6` · base `origin/develop@38e87a027c530dbbe11beae9a62bc6732f65ca59` · document `.agents/spec-docs/backlog/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` blob `c9794ff38eb5bac258b580013716fa6038d8ebc1` (modified)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-13

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : 1 path(s) outside the paired spec/Task: .agents/spec-docs/draft/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md
  **Required action:** commit, stash, or remove them before this gate

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `2b0b28ef1e3d` · base `origin/develop@38e87a027c53` · document `.agents/spec-docs/todo/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` blob `96b76b0b48ed` (modified)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-13

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "모듀 승인함"
**Given:** 2026-09-13, this conversation
**Review fingerprint:** 8bf0996e09f9 (review d7d752b2, type/tags 74b52707)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-13, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (8bf0996e09f9) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `5cfa1b18f91a` · base `origin/develop@38e87a027c53` · document `.agents/spec-docs/todo/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` blob `fec5f2fde428` (modified)

### Withdrawn uncommitted GATE-IMPLEMENT attempt | 2026-09-13

**Disposition:** Withdrawn before a successful checkpoint commit; not a valid GATE-IMPLEMENT PASS.
**Original heading (quoted):** `### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-13`
**Original status line (quoted):** `**Status upgrade:** approved → in-progress`
**Observed judge output:** `gate GATE-IMPLEMENT (lane L2): 7 criteria judged — 7 PASS, 0 FAIL, 0 PENDING-GUARDIAN`; exit 0, with an Evidence Log entry appended.
**Checkpoint commit rejection:** `gateImplementFirst.worktreePaths must be the paired Task/spec plus only PLAN ledger paths`.

The judge observed only the dirty spec; the paired Task was clean at that time. The subsequent
advance activated the Task, so the generated first-checkpoint payload did not bind both required
paths. This is a producer/consumer evidence mismatch, not successful checkpoint admission.
The original criterion output, spec-only payload and judged identity below are preserved without
adding the Task retrospectively. Main restored the uncommitted planning state to spec todo/approved
and Task todo; no implementation is claimed. This withdrawal is neither legacy correction nor
continuation and grants no implementation authority. Earlier committed entries remain unchanged.

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-13; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (6)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 554 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 6`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 1 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md",
  "specPath": ".agents/spec-docs/todo/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 6
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `5cfa1b18f91a` · base `origin/develop@38e87a027c53` · document `.agents/spec-docs/todo/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` blob `64aabb9822a0` (modified)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-13

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-13; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (6)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 554 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 6`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md",
  "specPath": ".agents/spec-docs/todo/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 6
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md",
    ".agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `5cfa1b18f91a` · base `origin/develop@38e87a027c53` · document `.agents/spec-docs/todo/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` blob `b0e3fb0a03d7` (modified)

### Final per-criterion evidence handoff — 2026-09-13

These are author-prepared verification inputs, not new independent gate verdicts or canonical
`GATE-COMPLETE` PASS entries. The initial landing hold in this preparation table is resolved by
the subsequent Hume addendum below; named gate judgment remains separate. No verification command below was rerun locally for this
closeout; remote logs were read with `gh api repos/woojubb/robota/actions/jobs/<job-id>/logs`
(readback commands exited 0), and historical local results retain their original scope.
All final CI results below bind head `c8e814c62cc1f5263f95ced9360f3e1104b1f5a9`.

| Criterion | Exact verification action / executed command                                                                                                                                                                                                                                                 | Observed result and limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TC-01     | Read the paired Task's final population reconciliation, original 122-path semantic review fingerprint and bounded SDP/CSS supplement; read final scans job `103683620639` for `package-boundary-ownership`.                                                                                  | Historical inventory reconciles 8608 tracked / 0 untracked / 12 symlink exclusions after the owned SDP supplement; the 122 reviewed unknown paths plus the new sample are explicitly accounted for. Historical source analysis reports 4210 sources, 20261 references, 197 config references and 2381 unresolved references. Final remote boundary scan passed. These dated counts are not a fresh inventory of subsequent closeout documents, nor evidence that every runtime expression is resolved. Semantic review is an action with no process exit code; remote scan step succeeded. |
| TC-02     | Read `.agents/package-boundaries.json` decisions against the paired Task's independent source/SPEC review; final remote contract and boundary scan execution in job `103683620639`.                                                                                                          | Two process APIs meet neutral owned API and independent package consumer criteria; three public-alias bindings and 208 exact tooling/config references are separately justified. Public pairing `extractDtlsFingerprint` remains domain-owned under its SPEC/public barrel and Node/browser consumers, not omitted or made a fourth alias exception. No in-repo caller threshold is imposed on approved public domain contracts. Remote step succeeded; semantic disposition is not a new gate judgment.                                                                                   |
| TC-03     | Historical owner-local migration tests and six actual SDK/example scenarios in the Task; final build job `103683620725` full `pnpm test`; TUI job `103685321549`: `pnpm --filter @robota-sdk/agent-transport-tui test:pty`.                                                                  | Hook/session/recorder/provider composition, role contract, pairing fixture and sealed doctor evidence is preserved in the Task and exact test references above. Final helper self-tests 6/6, command handoff 2/2, terminal handoff 1/1; real TUI command 32 tests / 15 files passed. CI steps succeeded (exit 0); no local HOME/PTY run or paid recording is claimed.                                                                                                                                                                                                                      |
| TC-04     | Historical positive/negative scanner/reference/wiring regressions in the Task; final scans execute `pnpm harness:test:contracts:affected -- --base-ref "${HARNESS_BASE_REF}" --head-ref HEAD` and `pnpm harness:test:hermetic`.                                                              | Boundary scan passed, contract runners submitted all 272 selected entries with zero failed shards, hermetic 1218/1218 passed; successful steps, exit 0. The Git-free repair retains default Git error propagation, explicit full filesystem analysis and explicitly not-performed metadata projections; historical Pascal 71 and artifact 35 focused passes are corroborating bounded evidence, not substituted for CI.                                                                                                                                                                    |
| TC-05     | Same final contract command; read the top-level contract summary in job `103683620639`, together with the existing typed-input/cache/projection/reporting test results in the Task.                                                                                                          | `control-plane input changed: .agents/harness.config.json; 272/272 selected`; 0 hits / 272 misses; 34 successful misses recorded; 272 submitted / 0 not invoked / 0 failed shards. Exit 0. Markers and submitted entries are not individual test-case totals. Historical registry 238 uncertain/always-run and 34 cacheable entries makes uncertainty visible; neither broad final selection nor marker writes prove reduced fanout.                                                                                                                                                       |
| TC-06     | Build job `103683620725`: clean command sequence below, full `pnpm build`, full package-quality checks, `pnpm harness:scan:build-contracts`, `pnpm exec vitest run scripts/artifacts/__tests__`; read run/jobs API and PR API; consume independent Hume landing verification when available. | Clean plan 16 packages / `globalFallback=false`, explicit regressions 12 passed, affected operation 1795 passed, full build 81 tasks passed, full quality/output scan succeeded, artifact tests 104 passed / 1 skipped; steps exited 0. CI run has 13 non-skipped successful jobs. PR API records owner merge, but Hume's current overall FAIL is solely missing owner-landing comment; revalidation is pending. TC-06 remains unchecked and no terminal completion or all-required-checks GREEN claim is made.                                                                            |

Exact clean-framework command sequence executed in the build job before the full workspace build:

```sh
node scripts/harness/workspace-affected-run.mjs --operation build --changed-file packages/agent-framework/src/index.ts
pnpm --filter @robota-sdk/agent-framework exec vitest run --no-cache \
  src/interactive/__tests__/interactive-session-background-tasks.test.ts \
  src/testing/__tests__/session-log-external-payload-replay-functional.test.ts \
  src/testing/__tests__/usage-assertion-functional.test.ts
node scripts/harness/workspace-affected-run.mjs --operation test --changed-file packages/agent-framework/src/index.ts
```

Authoritative remote evidence:
[final CI](https://github.com/woojubb/robota/actions/runs/34742172142),
[build](https://github.com/woojubb/robota/actions/runs/34742172142/job/103683620725),
[scans](https://github.com/woojubb/robota/actions/runs/34742172142/job/103683620639),
[TUI](https://github.com/woojubb/robota/actions/runs/34742172142/job/103685321549),
[merged PR](https://github.com/woojubb/robota/pull/2718), and
[Round B disposition](https://github.com/woojubb/robota/pull/2718#issuecomment-5651707829).
Round B records zero unresolved after three refutations and seven deferrals to existing Issue #2680;
it is not a new full-head review or a claim that deferred findings were implemented.
PR API readback records `woojubb` merging at `2026-09-13T07:18:14Z`, merge
`fa7984f59358682ab472b1adf96297767715ef4e`. The separate workflow-provenance run
`34742171400` remains RED, not retroactively GREEN. The required owner-landing record and Hume's
actual revalidation are still needed before the final gate/archival. Status, Task projection and
historical gate entries below are unchanged; no execution-loop closure is fabricated.

Subsequent landing evidence: Hume revalidated
[owner-landing record 5651926138](https://github.com/woojubb/robota/pull/2718#issuecomment-5651926138)
and returned **MERGE VERIFIED PASS**. Remote develop remains
`fa7984f59358682ab472b1adf96297767715ef4e`; its tree
`0b274f7b8a014beaaa2b2d21787a9eadde750133` equals the delivering head tree. This resolves the
specific missing-record blocker in the preparation table above without rewriting its historical
FAIL or the provenance RED. Nash read back the actual owner comment. TC-06 is now ready for the
named gate; Main alone owns post-merge ledger `r20260913071957` and parent/source projection.

Final source delivery: [Issue #2490 comment 5651937294](https://github.com/woojubb/robota/issues/2490#issuecomment-5651937294)
was published and read back. Main reports `r20260913071957` CLOSED/converged `[1,0]` with exact
merge/owner/Hume witnesses, source-branch cleanup complete and current base fresh. That ledger
was not edited by this worker. Parent umbrella acceptance remains separately owned.

Mechanical verification handoff: `gate.mjs judge --gate GATE-VERIFY` on this exact active spec
with `--dry-run` returned exit 2: **3 PASS, 0 FAIL, 2 PENDING-GUARDIAN**. The `--verify-cmd`
was a read-only Node assertion fetching `gh api repos/woojubb/robota/actions/jobs/103683620725`,
requiring exact head `c8e814c62cc1f5263f95ced9360f3e1104b1f5a9` and successful job/steps:
`Clean framework-only build and regression proof`, `Build full or affected workspace`,
`Verify full or affected package quality concurrently`, `Build-output contracts scan (dist-dependent)`
and `Verify artifact generation, exact pack and release-path regressions`. It exited 0 and printed
`Verified remote build/test steps SUCCESS at exact c8e814c62 head; no local build/test executed.
CI34742172142 job103683620725.` The prior-gate/order criterion passed. The only pending criteria
are every Plan item complete and no Plan item blocked/pending; both are tagged mechanical but
have no current wording binding. The paired Task has six checked Plan items. No gate entry was
written. An independent guardian must judge those two criteria; this author does not judge the
content they wrote. Final GATE-COMPLETE, status transition and archival remain unperformed.

### [GATE-VERIFY] — ❌ FAIL | 2026-09-13

**Status remains:** in-progress
**Failed criteria:**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): no `--verify-cmd` supplied, so nothing was run
  **Required action:** pass the build/test command(s) via --verify-cmd
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): no `--verify-cmd` supplied, so nothing was run
  **Required action:** pass the build/test command(s) via --verify-cmd

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `58740713f46e` · base `origin/develop@fa7984f59358` · document `.agents/spec-docs/active/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` blob `4fd53188be3c` (modified)

### [GATE-VERIFY] — ✅ PASS | 2026-09-13

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: PASS. The last GATE-IMPLEMENT entry is PASS; this exact spec is in-progress, lane L2, in active/.
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`) (`task-plan-items`): PASS. The exact BOUNDARY-2655 Task has six checked items, TC-01 through TC-06, each bound to its recorded population, ownership, migration, enforcement, reporting or delivery evidence.
- GATE-VERIFY — No Plan item is blocked or pending: PASS. Final remote PTY/CI evidence, Hume's subsequent MERGE VERIFIED PASS, owner comment 5651926138 and source delivery 5651937294 resolve the earlier documented holds. Those historical failures remain preserved. Parent terminal projections are separate delivery actions, not unresolved child implementation.
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): PASS. The read-only assertion below exited 0 for exact head c8e814c62cc1f5263f95ced9360f3e1104b1f5a9 and successful clean-framework, full-workspace, quality, output-contract and artifact-regression steps in job 103683620725. Actual root build: 81 tasks; clean affected build: 16 packages, globalFallback=false.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): PASS. The same actual job/step readback verifies package quality and artifact regressions. Recorded remote results remain 12 focused framework tests, 1795 affected tests and 104 artifact PASS / 1 SKIP; final scans and TUI jobs succeeded. No local product tests or CI reruns were performed.

**Verification command:**

```sh
node --input-type=module -e 'import assert from "node:assert/strict"; import {execFileSync} from "node:child_process"; const j=JSON.parse(execFileSync("gh",["api","repos/woojubb/robota/actions/jobs/103683620725"],{encoding:"utf8"})); assert.equal(j.head_sha,"c8e814c62cc1f5263f95ced9360f3e1104b1f5a9"); assert.equal(j.conclusion,"success"); for(const name of ["Clean framework-only build and regression proof","Build full or affected workspace","Verify full or affected package quality concurrently","Build-output contracts scan (dist-dependent)","Verify artifact generation, exact pack and release-path regressions"]) { const s=j.steps.find(s=>s.name===name); assert.ok(s,name); assert.equal(s.conclusion,"success",name); } console.log("Verified remote build/test steps SUCCESS at exact c8e814c62 head; no local build/test executed. CI34742172142 job103683620725.");'
```

**Observed output (exit 0):** Verified remote build/test steps SUCCESS at exact c8e814c62 head; no local build/test executed. CI34742172142 job103683620725.

The preceding mechanical FAIL records an invocation without --verify-cmd, not a product failure. The corrected invocation returned 3 PASS, 0 FAIL and 2 PENDING-GUARDIAN; this independent judgment resolves those two Plan wording bindings. Final result including ordering: 5 PASS, 0 FAIL, 0 pending. Workflow provenance remains owner-landed RED, not GREEN.

**Judged by:** Carson, independent backlog-gate-guard; not the child implementation/completion author.
**Subject:** .agents/spec-docs/active/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md and its exact paired Task; CI head c8e814c62cc1f5263f95ced9360f3e1104b1f5a9; Hume-verified merge fa7984f59358682ab472b1adf96297767715ef4e.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-13

**Command:** `Read paired Task final population reconciliation (122-path fingerprint plus owned SDP supplement), named inventory tests and current six checked criteria; read gh api repos/woojubb/robota/actions/jobs/103683620639/logs for actual boundary scan. Historical population counts are not a new recount.`
**Exit:** 0
**Output:** (last 8 of 8 line(s))

```
Read-only GitHub evidence readback; no local product tests or CI reruns. ANSI display codes removed only.
2026-09-13T06:12:53.0689125Z  * [new branch]          fix/2655-package-boundary-ownership -> origin/fix/2655-package-boundary-ownership
2026-09-13T06:18:47.2875981Z [contract-tests] complete: control-plane input changed: .agents/harness.config.json; 272/272 selected
2026-09-13T06:18:47.3278774Z [contract-tests] coverage: 0 cache-reused; 0 submitted to runners; 0 not invoked; 0 failed shard(s)
2026-09-13T06:18:47.3280495Z [contract-tests] coverage: 0 cache-reused; 0 submitted to runners; 0 not invoked; 0 failed shard(s)
2026-09-13T06:18:47.3342791Z [contract-tests] coverage: 0 cache-reused; 272 submitted to runners; 0 not invoked; 0 failed shard(s)
2026-09-13T06:18:47.3375596Z ✓ package-boundary-ownership
2026-09-13T06:18:47.3474625Z       Tests  1218 passed (1218)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `58740713f46e` · base `origin/develop@fa7984f59358` · document `.agents/spec-docs/active/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` blob `b1a980bc54bc` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-13

**Command:** `Read named shared API consumers and public/domain dispositions in .agents/package-boundaries.json against the Task independent review and exact positive/negative test names; read gh api repos/woojubb/robota/actions/jobs/103683620639/logs for actual boundary scan. Low internal counts are not public API removal grounds.`
**Exit:** 0
**Output:** (last 8 of 8 line(s))

```
Read-only GitHub evidence readback; no local product tests or CI reruns. ANSI display codes removed only.
2026-09-13T06:12:53.0689125Z  * [new branch]          fix/2655-package-boundary-ownership -> origin/fix/2655-package-boundary-ownership
2026-09-13T06:18:47.2875981Z [contract-tests] complete: control-plane input changed: .agents/harness.config.json; 272/272 selected
2026-09-13T06:18:47.3278774Z [contract-tests] coverage: 0 cache-reused; 0 submitted to runners; 0 not invoked; 0 failed shard(s)
2026-09-13T06:18:47.3280495Z [contract-tests] coverage: 0 cache-reused; 0 submitted to runners; 0 not invoked; 0 failed shard(s)
2026-09-13T06:18:47.3342791Z [contract-tests] coverage: 0 cache-reused; 272 submitted to runners; 0 not invoked; 0 failed shard(s)
2026-09-13T06:18:47.3375596Z ✓ package-boundary-ownership
2026-09-13T06:18:47.3474625Z       Tests  1218 passed (1218)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `58740713f46e` · base `origin/develop@fa7984f59358` · document `.agents/spec-docs/active/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` blob `1580e42f32f3` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-13

**Command:** `Read Task owner-local migration and six executed scenario evidence; verify named migration/recorder/PTY test references; read gh api repos/woojubb/robota/actions/jobs/103685321549/logs for the real test:pty result. No local HOME/PTY tests executed.`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Read-only GitHub evidence readback; no local product tests or CI reruns. ANSI display codes removed only.
2026-09-13T06:29:23.4093492Z ##[group]Run pnpm --filter @robota-sdk/agent-transport-tui test:pty
2026-09-13T06:29:23.4093968Z pnpm --filter @robota-sdk/agent-transport-tui test:pty
2026-09-13T06:29:23.8103761Z > @robota-sdk/agent-transport-tui@3.0.0-beta.79 test:pty /home/runner/work/robota/robota/packages/agent-transport-tui
2026-09-13T06:30:15.8648292Z  Test Files  15 passed (15)
2026-09-13T06:30:15.8649331Z       Tests  32 passed (32)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `58740713f46e` · base `origin/develop@fa7984f59358` · document `.agents/spec-docs/active/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` blob `5bf0d2542618` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-13

**Command:** `Read Task scanner/reference/wiring positive-negative evidence and named test references; read gh api repos/woojubb/robota/actions/jobs/103683620639/logs for boundary, actual contract coverage and hermetic results. No local Git fixtures executed.`
**Exit:** 0
**Output:** (last 8 of 8 line(s))

```
Read-only GitHub evidence readback; no local product tests or CI reruns. ANSI display codes removed only.
2026-09-13T06:12:53.0689125Z  * [new branch]          fix/2655-package-boundary-ownership -> origin/fix/2655-package-boundary-ownership
2026-09-13T06:18:47.2875981Z [contract-tests] complete: control-plane input changed: .agents/harness.config.json; 272/272 selected
2026-09-13T06:18:47.3278774Z [contract-tests] coverage: 0 cache-reused; 0 submitted to runners; 0 not invoked; 0 failed shard(s)
2026-09-13T06:18:47.3280495Z [contract-tests] coverage: 0 cache-reused; 0 submitted to runners; 0 not invoked; 0 failed shard(s)
2026-09-13T06:18:47.3342791Z [contract-tests] coverage: 0 cache-reused; 272 submitted to runners; 0 not invoked; 0 failed shard(s)
2026-09-13T06:18:47.3375596Z ✓ package-boundary-ownership
2026-09-13T06:18:47.3474625Z       Tests  1218 passed (1218)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `58740713f46e` · base `origin/develop@fa7984f59358` · document `.agents/spec-docs/active/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` blob `37b2aba1fca1` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-13

**Command:** `Read typed input/cache/projection/reporting evidence and named test references; read gh api repos/woojubb/robota/actions/jobs/103683620639/logs for actual promotion reason and submitted/not-invoked/failed coverage. Submitted entries are not individual test totals.`
**Exit:** 0
**Output:** (last 8 of 8 line(s))

```
Read-only GitHub evidence readback; no local product tests or CI reruns. ANSI display codes removed only.
2026-09-13T06:12:53.0689125Z  * [new branch]          fix/2655-package-boundary-ownership -> origin/fix/2655-package-boundary-ownership
2026-09-13T06:18:47.2875981Z [contract-tests] complete: control-plane input changed: .agents/harness.config.json; 272/272 selected
2026-09-13T06:18:47.3278774Z [contract-tests] coverage: 0 cache-reused; 0 submitted to runners; 0 not invoked; 0 failed shard(s)
2026-09-13T06:18:47.3280495Z [contract-tests] coverage: 0 cache-reused; 0 submitted to runners; 0 not invoked; 0 failed shard(s)
2026-09-13T06:18:47.3342791Z [contract-tests] coverage: 0 cache-reused; 272 submitted to runners; 0 not invoked; 0 failed shard(s)
2026-09-13T06:18:47.3375596Z ✓ package-boundary-ownership
2026-09-13T06:18:47.3474625Z       Tests  1218 passed (1218)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `58740713f46e` · base `origin/develop@fa7984f59358` · document `.agents/spec-docs/active/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` blob `e938784a4503` (modified)

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-09-13

**Command:** `Read gh api repos/woojubb/robota/actions/jobs/103683620725 and assert exact c8e814c62cc1f5263f95ced9360f3e1104b1f5a9 plus successful build/test steps; read PR merge metadata and actual comments 5651926138/5651937294; consume supplied independent Hume MERGE VERIFIED PASS for fa7984f59358682ab472b1adf96297767715ef4e. Provenance stays owner-landed RED.`
**Exit:** 0
**Output:** (last 2 of 2 line(s))

```
Read-only GitHub evidence readback; no local product tests or CI reruns. ANSI display codes removed only.
{"conclusion":"success","head_sha":"c8e814c62cc1f5263f95ced9360f3e1104b1f5a9","html_url":"https://github.com/woojubb/robota/actions/runs/34742172142/job/103683620725","steps":[{"conclusion":"success","name":"Clean framework-only build and regression proof"},{"conclusion":"success","name":"Build full or affected workspace"},{"conclusion":"success","name":"Verify full or affected package quality concurrently"},{"conclusion":"success","name":"Build-output contracts scan (dist-dependent)"},{"conclusion":"success","name":"Verify artifact generation, exact pack and release-path regressions"}]}
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `58740713f46e` · base `origin/develop@fa7984f59358` · document `.agents/spec-docs/active/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` blob `6038bc2c71dd` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-13

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-13; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 6/6 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (6)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (6) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (6) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 6/6 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (6) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 6/6 tasks `[x]` in .agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `58740713f46e` · base `origin/develop@fa7984f59358` · document `.agents/spec-docs/active/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md` blob `6310c1362409` (modified)
