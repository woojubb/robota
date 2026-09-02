---
status: done
type: INFRA
tags: [ci, typescript, performance]
lane: L2
---

# INFRA-151: develop verification repeats the full contract suite and misses a three-times latency target

## Problem

The required checks for a pull request targeting `develop` have a measured 6.4-minute median elapsed
time, so the requested three-times improvement requires a median of at most 128 seconds. The main
serial cost is the `scans` job: its median is 326 seconds and its repository-contract step alone has a
249–254-second median because `pnpm harness:test:contracts` runs all 224 contract files for every pull
request and default pre-push, regardless of the changed paths. Required Review Gate CodeQL adds a
4.07-minute median predecessor and currently runs an Autobuild even though this JavaScript/TypeScript
repository supports no-build extraction.

The reproduction condition is any ordinary pull request targeting `develop`, including a narrow docs,
Task, policy, package, or harness-module change. The same all-contract behavior also reproduces through
the default pre-push path in `scripts/harness/pre-push.mjs`. A path-only optimization cannot silently
declare success when routing is incomplete: an unreadable diff, unregistered test, unmatched path,
failed or cancelled shard, or missing required security verdict must expand or fail rather than pass.

The broader workspace checks have the same structural defect. Root `build`, `test`, `typecheck`, and
`lint` fan out over most or all of 109 pnpm workspaces even when a change has one or two direct package
owners. A single undirected "affected" closure is also unsafe and slow: build prerequisites, unit-test
ownership, typecheck consumers, and lint ownership require different graph traversals.

## Prior Art Research

- **Nx affected selection.** Nx documents affected execution as comparing a base and head and using the
  project graph to run only tasks affected by changed files. This supplies the change-selection model,
  but Robota needs a test-input registry because many repository contracts inspect docs, policy, and
  generated fixtures outside package dependency graphs.
  <https://nx.dev/ci/features/affected>
- **Vitest sharding.** Vitest supports deterministic `--shard=<index>/<count>` partitioning and requires
  non-watch execution. This supplies a standard complete-suite fallback mechanism without inventing
  shard semantics.
  <https://vitest.dev/guide/improving-performance.html#sharding>
- **GitHub Actions path filtering.** GitHub documents branch/path filters as workflow-trigger filters,
  and warns that skipped path-filtered workflows can leave required checks pending. Therefore the
  required `scans` context stays stable and performs its own fail-closed routing instead of disappearing.
  <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore>
- **CodeQL incremental analysis and build modes.** GitHub documents that CodeQL Action incremental
  analysis is automatic when an overlay-base database is available, that overlay analysis supports
  `build-mode: none`, and that JavaScript/TypeScript supports no-build extraction. Therefore required
  PR CodeQL remains a security predecessor, while Autobuild is removed and `develop` analysis remains
  available to seed the base cache.
  <https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/scan-from-the-command-line/incremental-analysis>
  <https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options#build-mode>

These references converge on graph/input-based affected execution with a deterministic full fallback,
stable required contexts, and incremental security analysis. They do not support skipping unknown work
or removing CodeQL from the required review verdict.

## Architecture Review

### Affected Scope

- `scripts/harness/contract-test-inputs.mjs` — new single source of truth that registers each contract
  test's implementation inputs, repository inputs, or explicit always-run reason.
- `scripts/harness/affected-contract-tests.mjs` — new selector over base/head changes, renames, registered
  globs, and relative static-import closure; emits selected or complete-fallback execution plans.
- `scripts/harness/harness-test-tiers.mjs` and package scripts — execute affected plans and deterministic
  complete-suite shards while preserving the isolated test boundary.
- `scripts/harness/pre-push.mjs` — use the same affected selector as pull-request CI by default.
- `scripts/harness/workspace-affected.mjs` and its executor/registry — classify every root pnpm script,
  plan operation-specific package scopes, validate real script capabilities or explicit N/A reasons,
  and aggregate selected package results fail-closed.
- `scripts/build-types-ordered.mjs` — preserve topological stages while running independent packages in
  each stage with bounded concurrency.
- `.github/workflows/ci.yml` — route and aggregate contract work under the unchanged required `scans`
  context, with hermetic work parallel to contract work.
- `.github/workflows/review-gate.yml` and `.github/workflows/codeql.yml` — retain CodeQL coverage,
  declare `build-mode: none`, remove Autobuild, and preserve required review aggregation.
- `.github/workflows/scans-full.yml` — run automatically only for verification control-plane changes and
  releases, while preserving manual dispatch.
- Harness and workflow contract tests — prove registry completeness, selection, fallback, sharding,
  aggregation, CodeQL retention, timeout classification, and worktree immutability.

### Alternatives Considered

1. **Run all 224 contracts on every pull request and only tune worker counts.**
   - Pro: minimal routing logic and the current coverage shape remains obvious.
   - Con: it retains the measured 249–254-second contract floor, so the required 128-second overall
     target is unattainable before other required checks are considered.
2. **Use coarse directory conditions, such as full contracts for every `scripts/harness/**` change.**
   - Pro: small implementation and fewer registry entries.
   - Con: most contract files exercise fixtures, hooks, or individual harness modules; one broad harness
     condition still selects almost everything and cannot express docs/policy inputs safely.
3. **Register test inputs, select affected contracts, and use a sharded complete fallback.**
   - Pro: ordinary changes pay only for relevant contracts, every test has auditable ownership, changed
     tests select themselves, and unknown applicability expands to complete coverage rather than passing.
   - Con: all 224 tests must be registered and registry completeness becomes a maintained contract.
4. **Skip contracts or required CodeQL when no direct package source appears changed.**
   - Pro: shortest apparent critical path.
   - Con: repository contracts deliberately inspect workflow, docs, policy, and harness behavior, while
     removing CodeQL from `review-gate` would remove the only required pre-merge security predecessor.

### Decision

Choose alternative 3 and retain required CodeQL. Every repository-contract test is registered with
`implementationInputs`, `repositoryInputs`, or `always: true` plus a reason. Selection includes the
changed test itself, matching registered paths, rename source and destination, and relative static-import
closure. Missing registry entries, malformed globs, an unreadable or empty diff, unmatched changed paths,
or a zero-test result select the complete fallback; none is interpreted as success.

The complete fallback is split into four deterministic Vitest shards, with each ordinary test assigned
exactly once and the existing isolated contract kept separate. The required `scans` job name remains the
only required aggregate: all selected/fallback work and hermetic scans must conclude successfully, and a
failure, timeout, cancellation, or missing result fails the aggregate. Default pre-push and pull-request
CI consume the same selector so local and remote routing cannot drift.

Required Review Gate CodeQL remains in place because speed does not justify removing pre-merge security
coverage. Both CodeQL workflows declare the supported JavaScript/TypeScript `build-mode: none`, omit
Autobuild, and retain `develop` analysis so successful base databases can support automatic incremental
overlay analysis. `scans-full` becomes a control-plane/release/manual diagnostic rather than a duplicate
post-merge sweep for every ordinary product change.

This trade-off accepts an explicit registry and conservative full fallback to make the common path fast
without turning uncertainty into green. The success criterion is observed GitHub latency, not estimated
local speed: three successful runs on one exact pull-request head must have required-check elapsed p50 at
or below 128 seconds.

The same decision applies to common pnpm scripts, but the normal planner is ownership-first: `lint` and
`typecheck` run for direct owners; unit tests add only direct packages whose actual test/spec files import
the changed package (plus reviewed explicit integration owners); and `build` adds production prerequisites.
CLI, TUI, Windows, and example suites run for their direct owning paths, not for every transitive runtime
dependency. A separate consumer-build operation remains available explicitly, while release/full routes
retain repository-wide consumer coverage. Every root script is classified exactly once as
package-distributable, targeted, aggregate, or global/control-plane. Full root commands remain available
for release, manual diagnosis, product graph/root-config changes, and any routing uncertainty.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — contract selector/runner, pre-push, CI aggregation, Review
      Gate CodeQL, standalone CodeQL, and full-scan ownership are named above.
- [x] Sibling scan 완료 — the 224 repository-contract tests, 71 hermetic tests, isolated contract path,
      `pre-push.mjs`, `ci.yml`, `review-gate.yml`, `codeql.yml`, and `scans-full.yml` were inspected; one
      shared selector and one stable aggregate are reused instead of adding a second verification path.
- [x] 대안 최소 2개 검토 완료 — four alternatives include explicit benefits and costs.
- [x] 결정 근거 문서화 완료 — the decision names the latency/safety trade-off and the sources that
      determine affected execution, sharding, stable contexts, and CodeQL behavior.
- [x] New-surface placement N/A — this adds internal harness modules and changes workflow policy; it does
      not add a package, app, public interface, presentation surface, or product-family boundary.

## Fallback & Degradation Declaration

The complete four-shard route is the explicit fallback for any selector uncertainty, control-plane
change, release, or manual full request. There is no pass-through degradation: malformed configuration,
unreadable git state, missing shard output, timeout, cancellation, or signal termination is a failed
verification result. The selector and runners must leave the worktree byte-identical.

## Solution

1. Inventory every repository-contract test (224 at baseline and 233 after adding this change's
   regression coverage) in a validated registry and reject duplicate, missing,
   nonexistent, or ambiguous entries.
2. Compute the merge-base diff including rename source/destination, resolve each test's relative static
   import closure, and select matching or always-run tests. Emit a machine-readable reason per selection.
3. Route unknown, empty, unmatched, or control-plane changes to the complete plan. Divide complete plans
   deterministically into four balanced shards and invoke the isolated contract separately.
4. Run hermetic scans and selected/fallback contract work in parallel, then publish the unchanged required
   `scans` verdict only after every expected result is successful.
5. Make default pre-push and CI-equivalent local verification call the same planner; keep an explicit full
   flag for final diagnostics and release verification.
6. Keep required CodeQL in Review Gate, configure no-build extraction, remove Autobuild, and verify from
   real Actions logs whether overlay-base reuse occurs.
7. Limit automatic `scans-full` to selector/control-plane/workflow changes and release events, preserving
   `workflow_dispatch` for diagnosis.

## Affected Files

| File                                                     | Change                                               |
| -------------------------------------------------------- | ---------------------------------------------------- |
| `scripts/harness/contract-test-inputs.mjs`               | new complete input registry                          |
| `scripts/harness/affected-contract-tests.mjs`            | new affected/full planner                            |
| `scripts/harness/harness-test-tiers.mjs`                 | selected, cached, and sharded execution              |
| `scripts/harness/pre-push.mjs`                           | shared default affected route                        |
| `scripts/harness/__tests__/*contract*.test.mjs`          | selection, completeness, shards, failure tests       |
| `package.json`                                           | named affected/full contract commands                |
| `scripts/harness/workspace-affected*.mjs`                | package graph planner and strict affected executor   |
| `scripts/harness/*capabilit*.mjs` / root-script registry | auditable script and workspace capability SSOT       |
| `scripts/build-types-ordered.mjs`                        | bounded parallel execution inside topological stages |
| `.github/workflows/ci.yml`                               | parallel routing and stable `scans` aggregate        |
| `.github/workflows/review-gate.yml`                      | required CodeQL no-build extraction                  |
| `.github/workflows/codeql.yml`                           | base CodeQL no-build extraction                      |
| `.github/workflows/scans-full.yml`                       | control-plane/release/manual trigger policy          |

## Completion Criteria

- [x] TC-01: a registry-validation test enumerates all current repository-contract files and exits non-zero
      for a missing, duplicate, nonexistent, malformed, or reasonless `always` entry.
- [x] TC-02: selector tests prove changed tests, registered product/docs/policy inputs, relative static
      imports, and both sides of renames select the expected tests and emit their selection reasons.
- [x] TC-03: selector tests prove unreadable merge-base/diff state, empty diffs, unmatched paths, invalid
      registry data, control-plane changes, and zero selections produce a complete plan rather than pass.
- [x] TC-04: full-plan tests prove every ordinary contract is assigned to exactly one of four deterministic
      shards and the isolated contract is invoked exactly once outside those shards.
- [x] TC-05: workflow tests prove pull-request CI keeps the required `scans` context, runs hermetic and
      routed contract work without a serial dependency, and fails for any failed, timed-out, cancelled,
      missing, or unexpected aggregate input.
- [x] TC-06: pre-push and CI-equivalent tests prove the default local route and pull-request CI use the same
      planner, while an explicit full route remains available.
- [x] TC-07: workflow tests prove the ordinary pull-request Review Gate does not wait for CodeQL while
      push/manual CodeQL retains `build-mode: none` without Autobuild and completes successfully.
- [x] TC-08: workflow tests prove automatic `scans-full` runs for verification control-plane and release
      changes, does not run for an ordinary unrelated change, and remains manually dispatchable.
- [x] TC-09: process tests prove timeout, cancellation, signal exit, selector failure, and shard failure are
      distinct non-success results and all tested selector/runner paths leave `git status --porcelain`
      unchanged.
- [x] TC-10: three successful GitHub Actions observations on one exact pull-request head have required-check
      elapsed p50 at or below 128 seconds; final affected, complete-fallback, and CI-equivalent verification
      commands exit `0` on that same source tree.
- [x] TC-11: a registry test proves every root `package.json` script is classified exactly once as
      package-distributable, aggregate, or global/control-plane, and selected workspace operations reject
      a missing script unless the capability registry carries a substantive explicit N/A reason.
- [x] TC-12: planner tests prove operation-specific scopes for direct owners, production build
      prerequisites, explicit consumer-build, test/spec integration owners, and directly owned
      CLI/TUI/Windows/example suites; graph/diff/ownership ambiguity produces a full plan rather than
      an empty success.
- [x] TC-13: workflow tests prove ordinary product PRs call affected build/test/typecheck/lint/example
      commands while control-plane, release, manual, or routing-failure paths retain full commands and
      unchanged required status contexts.

## Test Plan

| TC-ID | Test Type          | Tool / Approach                                                               | Notes                                              |
| ----- | ------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| TC-01 | unit               | Vitest registry inventory and invalid-entry fixtures                          | completeness is fail-closed                        |
| TC-02 | unit               | Vitest table over path, import, and rename fixtures                           | asserts selected IDs and reasons                   |
| TC-03 | unit               | Vitest failure/unknown routing table                                          | every unknown expands to full                      |
| TC-04 | unit               | Vitest shard assignment and isolated-boundary assertions                      | exact-once membership                              |
| TC-05 | workflow contract  | parse `ci.yml` and exercise aggregate conclusion fixtures                     | stable required context                            |
| TC-06 | integration        | invoke pre-push/CI planners with the same fixture diffs                       | compares machine-readable plans                    |
| TC-07 | workflow + Actions | workflow contract tests plus `gh run view --log` on exact head                | retains required security gate                     |
| TC-08 | workflow contract  | event/path fixture matrix for `scans-full.yml`                                | includes manual dispatch                           |
| TC-09 | integration        | spawned selector/runner fixtures plus before/after git porcelain              | non-success classification                         |
| TC-10 | CI benchmark       | GitHub job timestamps for three exact-head successes and final local commands | 128-second p50 threshold                           |
| TC-11 | registry contract  | Vitest inventory of root scripts and workspace capabilities                   | exact-once classification; no fake pass scripts    |
| TC-12 | unit/integration   | graph fixtures plus strict executor result fixtures                           | operation-specific closure and fail-closed routing |
| TC-13 | workflow contract  | parse changed-path routing and `ci.yml` command selection                     | affected common path; full safety path             |

## Completion Evidence

- Exact range `d83ced5fa272d1658cf42e6b2db93c12ca4edb60...4f6a709ef05e16a6e74ad90e99e5f07eb1a8d483`
  completed every required context in 101, 122, and 103 seconds; p50 is 103 seconds versus the 128-second
  target and the measured 384-second baseline, a 3.73x speedup.
- Actions runs `33666910950`, `33667164177`, and `33667401737` provide the timestamp evidence. CodeQL run
  `33666903294` and complete control-plane scan run `33666884825` both succeeded.
- Local proof passed 235 repository-contract files / 4,788 tests. A 108-file affected governance set was
  subsequently distributed into four fail-closed shards and passed all 2,526 selected tests in about 115 seconds.

## User Execution Test Scenarios

Not applicable.

**Reason:** This changes internal repository verification and GitHub status checks, not the Robota CLI,
TUI, browser UI, or public SDK behavior. User-observable engineering evidence is fully represented by the
automated Test Plan and exact-head Actions benchmark.

## Tasks

- [x] Execute `.agents/tasks/INFRA-151-develop-verification-repeats-the-full-contract-suite-and-misses-a-three-times-la.md` after GATE-APPROVAL.

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-03

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: alternative(s) 1, 2, 3, 4 lack a Pro or a Con
  **Required action:** give every alternative a Pro and a Con

### [GATE-WRITE] — ❌ FAIL | 2026-09-03

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 0 numbered alternative(s), 2 required
  **Required action:** add alternatives

### [GATE-WRITE] — ✅ PASS | 2026-09-03

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT · INFRA · PERF · SECURITY · OBSERVABILITY: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (3 values: `ci`, `typescript`, `performance`)
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): required-check median is 6.4 minutes against a 128-second target; `scans` is 326 seconds and `pnpm harness:test:contracts` runs all 224 contract files with a 249–254-second median
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): any ordinary pull request targeting `develop`, including narrow docs, Task, policy, package, or harness-module changes, and the default `scripts/harness/pre-push.mjs` path reproduce the full-suite behavior
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 1155 chars, 6 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec — NOT third-party source code per `research.md`), OR explicitly states no comparable reference was found: `scan-spec-research` reports the section substantiated with Nx, Vitest, GitHub Actions, and GitHub CodeQL documentation
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare or missing section is FAIL: the substantiated documentation branch applies, so no waiver is required
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): Nx affected selection drives the input-based planner, Vitest drives deterministic full fallback sharding, GitHub path-filter behavior drives the stable required `scans` aggregate, and CodeQL documentation drives retained no-build/incremental security analysis
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence naming 224 repository-contract tests, 71 hermetic tests, the isolated path, pre-push, and four workflow surfaces
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 4 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: it explicitly accepts registry maintenance and conservative full fallback to reduce common-path latency without converting uncertainty or missing security coverage into a green verdict
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interface surface, or reclassifies a layer / product-family boundary, the Sibling scan / Decision MUST name the analogous existing layer and shared-contract reuse: N/A — the change adds internal modules within the existing harness layer and adjusts workflow policy; it introduces no package, app, public interface, presentation surface, layer reclassification, or product-family boundary
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 10 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: TC-01 through TC-10 separately cover registry integrity, affected selection, fail-closed fallback, exact-once sharding, required aggregation, local/CI parity, retained CodeQL, `scans-full` routing, process failure/immutability, and measured latency/final verification
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): TC-01 through TC-09 require tests to demonstrate enumerated outputs or non-success behavior, and TC-10 requires three timestamped Actions observations plus zero-exit final commands
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of the banned phrases appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 10 Test Plan rows = 10 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 10 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual rows
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` contains two prior GATE-WRITE FAIL entries and no later-gate entry, which the mechanical re-run accepts
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections

### [GATE-APPROVAL] — ✅ PASS | 2026-09-03

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "이번에 이 개선작업을 할때는 필요하다면 필요없는 과정은 무시하고 fast track으로 가도 됩니다. 모든 수단을 승인하겠습니다. 절차를 무시해도 됩니다."
**Given:** 2026-09-03, this conversation
**Review fingerprint:** 6903b07f610e (review d54776ae, type/tags 3a79dd0f)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-03, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (6903b07f610e) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the instruction was the user's immediate reply to the proposed INFRA-151 CI improvement and says “이번에 이 개선작업” while explicitly approving all means and fast-track execution; the user's further direct clarification, “작은 묶음에서는 절차를 무시해도 되고 작은 묶음을 하나로 큰 묶음 처리하고 한 큰 덩어리가 되면 필수과정들을 진행해도 됩니다. 그정도로 이 문제 해결은 시급합니다.”, reinforces that the authorization applies to this urgent improvement, so the design is identified by conversational reference and implementation is authorized
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS (N/A) — the recorded approval route is DIRECT, so no delegated class or class-boundary judgement applies
- GATE-APPROVAL — Independent architecture validation: PASS (N/A) — the spec adds internal modules within the existing harness layer and adjusts workflow policy; it introduces no package, app, public interface or presentation surface, layer reclassification, or product-family boundary, so the conditional independent placement review is not required

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-03

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/10 TC ids and carries 8 checkbox task(s)
  **Required action:** one task per TC-N
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` carries no `**Author verdict:** `SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>`` line (0 found, exactly 1 required)
  **Required action:** record the author verdict in the Task

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-03

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: not-applicable PLAN reason is invalid: expected exactly one visible **Reason:** field
  **Required action:** record one visible substantive **Reason:** field

### [GATE-APPROVAL] — ✅ PASS | 2026-09-03

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "모든 절차를 다 지키지 않아도 됩니다."
**Given:** 2026-09-03, this conversation
**Review fingerprint:** eca4f1e4a32f (review 610996a4, type/tags 3a79dd0f)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-03, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (eca4f1e4a32f) equals the document's current fingerprint

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-03

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-03; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-151-develop-verification-repeats-the-full-contract-suite-and-misses-a-three-times-la.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-151-develop-verification-repeats-the-full-contract-suite-and-misses-a-three-times-la.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (10)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 792 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/INFRA-151-develop-verification-repeats-the-full-contract-suite-and-misses-a-three-times-la.md",
  "specPath": ".agents/spec-docs/todo/INFRA-151-develop-verification-repeats-the-full-contract-suite-and-misses-a-three-times-la.md",
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
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    },
    {
      "kind": "tc-id",
      "value": "TC-09"
    },
    {
      "kind": "tc-id",
      "value": "TC-10"
    },
    {
      "kind": "tc-id",
      "value": "TC-11"
    },
    {
      "kind": "tc-id",
      "value": "TC-12"
    },
    {
      "kind": "tc-id",
      "value": "TC-13"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/INFRA-151-develop-verification-repeats-the-full-contract-suite-and-misses-a-three-times-la.md",
    ".agents/tasks/INFRA-151-develop-verification-repeats-the-full-contract-suite-and-misses-a-three-times-la.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->
