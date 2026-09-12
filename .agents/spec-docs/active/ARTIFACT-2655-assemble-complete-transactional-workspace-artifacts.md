---
status: in-progress
type: INFRA
tags: [cli, typescript]
lane: L2
---

# ARTIFACT-2655: Assemble complete transactional workspace artifacts

Paired with `.agents/tasks/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md`.
Source acceptance: https://github.com/woojubb/robota/issues/2154, retained in https://github.com/woojubb/robota/issues/2655.

## Problem

Root `pnpm build` executes partial JavaScript scripts, then a separate declaration pass, while
affected execution calls package `build`. The private CLI web producer is missing from the first
path. The CLI's shell script recursively rebuilds producers and copies their output, but the
workspace graph has no copied-artifact edge. Web-only changes therefore need not select CLI assembly.
Copy removes live `dist/web` before writing, and subsequent tsdown output writes into live `dist/node`
with `clean:false`. A failure can retain old files or expose node/types/web from different builds.
Current output checks cover declared entry presence, not an independently expected complete file set.

## Prior Art Research

[tsdown output-directory configuration](https://tsdown.dev/options/output-directory) and
[build hooks](https://tsdown.dev/advanced/hooks) permit an adapter to redirect output and observe
emission without replacing the compiler. The installed package is tsdown 0.22.14; its public
entry exports `resolveUserConfig`, `buildWithConfigs` and `build`. Implementation must verify the
installed signatures, rather than assuming current online documentation matches that version.
Inspection shows `buildWithConfigs` is marked private despite being exported; do not depend on it.
Use public `build` with explicitly loaded package configuration, redirected per-config output and
`config:false`; preserve package entry/format/DTS settings. Its returned compiler chunks supply the
emitted-file oracle. A `build:prepare` mutation is insufficient: the installed implementation already
captures `outDir` before that hook, so the adapter must redirect before invoking the build.
[npm package file rules](https://docs.npmjs.com/cli/v8/configuring-npm/package-json/#files) distinguish
package inclusion rules from compiler output. A compiler manifest alone is not a packed-file oracle.
The resulting design reuses existing emitters and pnpm packaging, rather than introducing a build
framework or native filesystem dependency. Atomic pointer switching requires immutable generation
directories and consumers that resolve the pointer once; a recursive walk of a moving pointer does not
provide a snapshot. The feasibility and legacy-directory limitations below remain explicit.

## Architecture Review

### Affected Scope

Existing workspace graph, operation selection and execution under `scripts/harness/`; root build;
package build entrypoints/configuration under `packages/`, including nested `packages/dag-nodes/`;
CLI web copying; existing artifact checkers; pack, publish and CI artifact transfer consumers.
The current source inventory contains 82 package manifests: 81 expose JS/types scripts and all 82
expose `build`. The missing JS/types pair belongs to the private Vite producer, not an unbuildable
package. Apps/examples remain governed by their existing build capabilities, including conditional
desktop root assembly. No new workspace, product package, worktree or local clone is introduced.

### Alternatives Considered

1. Append CLI web commands to root build. Pro: small immediate fix. Con: leaves copied edges,
   generation mixtures and obsolete files undefined; explicitly insufficient for the source issue.
2. Stage outputs, rename the old directory away, then rename staging to `dist`. Pro: preserves
   ordinary directories and pack commands. Con: there is an observable missing-directory interval;
   rollback does not make the operation atomic. Rejected as a normal publication mechanism.
3. Reuse the existing graph with explicit artifact capabilities and copied edges; emit into immutable
   generations; atomically replace one managed `dist` link; materialize a pinned generation for
   packing. Pro: preserves the complete/atomic/exact objective with existing compilers and filesystem
   operations on POSIX build hosts. Con: legacy directory migration and non-POSIX build hosts need
   explicit treatment, and raw package-directory packing cannot be allowed to omit link contents.

### Decision

**Delivery mode:** `single`

Recommend alternative 3 as one integrated artifact change, not a graph-only delivery. Reuse the
existing graph/execution engine rather than add a parallel scheduler. Package-owned artifact
metadata declares the adapter and copied producer/output mapping; compiler configurations remain
the owner of entry points, formats and output subdirectories. Root and affected builds select the
same complete `build` capability. Only copied-artifact reverse consumers are added to build
selection; preserve existing test-only prerequisite closure and avoid expanding every ordinary
reverse dependency into a full build. CLI assembly no longer recursively rebuilds dependencies.

The assembly owner creates a fresh package-local generation, invokes tsdown or Vite with redirected
output, copies from pinned verified producer generations, validates the complete result, seals it,
then atomically renames a temporary relative link over managed `dist`. A failed or interrupted stage
never modifies the prior generation. No cleanup removes a generation a reader may still use.
Pack/copy/check consumers resolve the known link once, validate its package-owned target, and walk
only that physical directory without following internal symlinks. This is not permission to follow
links while enumerating the repository or dependency store.

Expected emitted paths and hashes come from compiler emission records and declared copied producer
manifests, not from enumerating whatever happens to remain in `dist`. Compare that expectation with
the actual generation, including extra files. Packed expectation combines the validated generation
with declared static package files and pnpm's workspace-version transformation; compare actual
tarball paths, bytes and relevant modes. Publication consumes that exact verified tarball, including
the existing skip-build path. Direct pack/release entrypoints and CI upload/download must either
use the same materialization boundary or fail clearly before accepting an incomplete artifact.
Keep OTP/auth/release approval and installed-product platform behavior unchanged; no actual npm
publication or main promotion is part of this Task.

Owner decision (verbatim, 2026-09-12): "windows 빌드의 원자성 보장 제외를 허용합니다."
Only the Windows atomic-switch guarantee is exempted. Keep Windows build compatibility, staged
complete output, exact emitted/packed validation and explicit failure reporting. The Windows
publication path may have a replacement interval; it must not report atomicity or mutate a live
generation file by file. Retain the previous output for recovery if replacement fails. This decision
alone did not authorize a non-atomic first transition on Linux/macOS or waive any other criterion.

Subsequent owner decision (verbatim, 2026-09-12): "dist 최초 전환도 승인합니다."
The first legacy physical-directory transition is now an explicit additional exception. Build and
validate the new generation before touching legacy output. Hold the build/pack writer lock, retain
the previous physical directory at an explicitly recorded backup path, then install the managed
pointer. If replacement fails, restore the previous output; if restoration also fails or the process
is interrupted, leave the backup and transaction record intact and report recovery as required.
Do not delete source files or user data. Legacy readers must be stopped for this one-time transition;
do not describe it as atomic or promise uninterrupted legacy processes. Subsequent Linux/macOS
managed switches remain atomic. No native filesystem binding or compiler toolchain is introduced.

Legacy physical `dist` is not a managed immutable generation. Its approved first transition is
announced explicitly and uses the backup/recovery protocol above; it is never reported as atomic.
No unsupported host may silently fall back to in-place writes. Current CI explicitly builds
`agent-core`, `agent-process` and `agent-executor` on Windows;
retain those build commands under the owner's atomicity-only exception. Product test support is not
a substitute for these existing build commands.

CI transfer is not the npm image. Export verified generation directories plus their package-relative
managed-link descriptors, then verify and restore that managed representation before downstream
affected builds. Never export a dangling link or restore a physical `dist` that the next build rejects.
The CLI Bun compiler currently writes `dist/bin`: move its platform executables into an independently
declared generation variant/output, with its existing consumers updated, rather than mutate the sealed
JS/types/web generation. Verify CLI web serving against a pinned generation, including request-time
file opens, not only a containment check.

Validation already performed: Nash verified all 82 package manifests, current root/affected drivers,
the missing copied edge, private web producer, CLI cleanup and publish paths. Carson's depth verdict
is `DEPTH: 1 FOUNDATIONAL of 1`: this existing Task owns the actual cause and full source criteria;
it is not a proposal endorsement. Pascal identified the concrete POSIX pointer/packing mechanism
and initial-directory limit. Independent proposal review is pending; no approval or implementation
checkpoint is claimed. Carson's first proposal verdict is `REVIEW VERDICT: REVISE` (2026-09-12):
the first legacy-directory exception needs an owner decision; existing Windows package builds must
be preserved; CI transfer must restore managed generations; Bun output and web-reader pinning must
be covered. CI restore and Bun/reader requirements are incorporated above. The later explicit owner
decisions resolve Windows atomicity and the first legacy-directory transition separately. Both
verbatim decisions are recorded above; neither waives complete-output or exact-manifest verification.
Carson independently reviewed revision 1 on 2026-09-12: `REVIEW VERDICT: ENDORSE`.
All four original design findings are resolved. This validates the recommendation only, not runtime
correctness, gate completion, or delivery. No new framework or native helper is needed.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — all 82 package manifests, root/affected and publish consumers inspected.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

Windows atomic publication and the first physical-dist transition are explicitly excluded by the
two quoted owner decisions. Their staged, validated replacement may be non-atomic, with preserved
prior output and explicit failure/recovery handling; file-by-file mixing and unverified success
remain forbidden. Other unsupported or unverified artifact states fail explicitly. Neither exception
permits a non-atomic normal managed switch on Linux/macOS.

## Solution

Use one package artifact owner with two existing-emitter adapters, explicit copied edges in the
current graph, immutable publication and independent emitted/packed verification. Wire all existing
root, affected, pack, publish and CI artifact consumers before treating the change as delivered.
Keep related implementation, tests and delivery records in one batch; do not add per-file gates.

## Affected Files

- `package.json`; package manifests and compiler configurations under `packages/`.
- `scripts/harness/workspace-graph.mjs`, `workspace-operation-selection.mjs`, `workspace-execution-plan.mjs` and the existing operation registry.
- Package artifact assembly, manifest verification and materialization modules under `scripts/`.
- `packages/agent-cli/scripts/copy-web-assets.mjs` and affected CLI/web package SPEC sections.
- `packages/agent-cli/scripts/build-bun.mjs` and `packages/agent-cli/src/modes/serve-monitor-ui.ts` for sealed-output and reader integration.
- `scripts/harness/check-build-output-contracts.mjs`, `scan-dist-freshness.mjs` and corresponding existing tests.
- `scripts/publish/publish-packages.sh`, `scripts/external-proof/run-external-proof.mjs`, root release entry and artifact transfer sections of `.github/workflows/ci.yml`.
- Artifact regression tests and the existing release-path corpus registration.

## Completion Criteria

- [ ] TC-01: Clean root and affected builds exit 0 with complete declared package artifacts, including private web producer and CLI copied assets; a web-only change selects and orders CLI reassembly without duplicate producer builds.
- [ ] TC-02: Node, browser, types and copied web are assembled only in staging; successful managed publication on Linux/macOS is atomic, and injected emit/copy/type failure or process interruption preserves the previous complete generation with no missing-path interval during publication. Windows is exempt only from atomic replacement: validate the full generation before switching, preserve prior output for recovery, and report interrupted/failed replacement explicitly.
- [ ] TC-03: Exact emitted-manifest verification rejects seeded obsolete files, removed-source outputs, missing files, byte mismatches, internal symlinks and mixed-generation copies; expectations are not derived from the directory under verification.
- [ ] TC-04: Actual tarball verification rejects missing/extra/modified payloads, preserves workspace dependency transformations and CLI bin/web behavior, and binds every supported pack/publish/skip-build/CI artifact path to the same verified generation.
- [ ] TC-05: The release-path corpus executes cold, stale-seeded and partial-failure cases with real emitters and real pack; relevant independent tests and required CI pass. Pure predicate tests alone do not establish this criterion.
- [ ] TC-06: Current clean framework-only affected build/test exits 0 without global fallback, builds analytics/replay before the three original #2653 regression files, and passes those files against fresh output; record the selected scope, commands and actual results.
- [ ] TC-07: The explicitly approved initial legacy-output transition preserves the old output, reports its non-atomic interval, and supports failure/interruption recovery. Preserve Windows build compatibility under its separate atomicity-only exception. Do not apply either exception to normal Linux/macOS managed publication. All criteria are delivered to origin/develop with issue evidence.

## Test Plan

INFRA strategy: focused graph/assembly tests plus real emitter, tarball and release-path integration.
Use canonical temporary ordinary-file fixtures only; no local Git fixtures, worktrees or clones.
One integration owner builds the closure, then runs dependent tests against stable output.

Current read-only framework plan selects 15 packages with `mode=packages`, `globalFallback=false`,
including analytics and replay. The original three files are
`src/interactive/__tests__/interactive-session-background-tasks.test.ts`,
`src/testing/__tests__/session-log-external-payload-replay-functional.test.ts`, and
`src/testing/__tests__/usage-assertion-functional.test.ts` under `packages/agent-framework`.
They use memory or ordinary-file fixtures, not Git repositories. The replay file has a Linux-only
test, so a macOS run cannot establish all 12 test cases; current full acceptance belongs to Linux CI.
Run the explicit framework changed-file build from absent package output, then the three files and
the full affected test operation against that output. This planner observation is not a build pass.

| TC-ID | Test Type | Tool / Approach | Notes |
| ----- | --------- | --------------- | ----- |
| TC-01 | Integration | Existing workspace graph/execution suites; clean root and web-only affected execution | Assert complete artifacts and copied-edge order, not only selected names |
| TC-02 | Integration | Real generation switch with concurrent pinned readers and fault injection | Compare old/new complete generations across success, failure and interruption; Windows checks staging/validation/recovery, not atomicity |
| TC-03 | Unit / Integration | Emitter-record oracle and stale/removed-entry/mixed-copy fixtures | Dist enumeration is the actual side only |
| TC-04 | Integration | Materialize and pnpm-pack real package; inspect and mutate tarball fixtures | No registry publication; check transformed metadata and CLI bin/web contents |
| TC-05 | CI smoke | Existing release-path corpus extended with cold/stale/failure cases | Run real emitters and pack in the owning CI environment |
| TC-06 | Integration | Framework-only affected build/test from absent package output | Preserve #2653 original three-file acceptance, analytics/replay and non-global plan |
| TC-07 | Integration | Legacy and build-host positive/negative cases; git/gh delivery readback | Unsupported or unverified paths are explicit failures, not partial success |

## User Execution Test Scenarios

Not applicable.

**Reason:** This changes repository build and artifact publication machinery rather than adding an
installed Robota product interaction. Real CLI packaged-output smoke checks remain engineering tests.

## Tasks

- [ ] `.agents/tasks/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md` — existing full-scope Task; detailed design validation before implementation.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-12

**Status upgrade:** draft → review-ready

**Ordering check:** PASS — GATE-WRITE is the entry gate and needs no predecessor. The exact document is in `draft/`, has `status: draft`, and its Evidence Log was empty before this append. This judgement changes neither status nor location.

- GATE-WRITE — File begins with YAML frontmatter: PASS — the document starts with a delimited `---` block before the title.
- GATE-WRITE — Draft status: PASS — `status: draft` is present.
- GATE-WRITE — Allowed type: PASS — `type: INFRA` is one of the eleven allowed types; `lane: L2` is explicit.
- GATE-WRITE — Tags present: PASS — `tags: [cli, typescript]` is declared.
- GATE-WRITE — Concrete symptom: PASS — Problem identifies root partial-JS/types execution versus package build, the omitted web producer/copied edge, live web deletion, `clean:false` output and entry-presence-only checking. These match the previously inspected original Issue #2154 and owning build/copy/publish paths.
- GATE-WRITE — Reproduction condition: PASS — clean root builds, web-only affected changes and failures during copy/node/types emission are named conditions that expose omission, stale files or generation mixtures; the document does not rely on a generic build-failure claim.
- GATE-WRITE — Problem has no placeholders or vague single sentence: PASS — the multi-sentence Problem specifies mechanisms and outcomes without TBD or TODO placeholders.
- GATE-WRITE — Prior Art Research section present: PASS — the named section exists.
- GATE-WRITE — Research substantiated by documentation: PASS — tsdown output-directory/hooks documentation and npm package-file documentation are cited and their relevance is explained. Installed-version signature verification is explicitly required rather than inferred from current online docs.
- GATE-WRITE — Research or explicit waiver route: PASS via substantive research — no waiver is needed or claimed; the section is neither bare nor missing.
- GATE-WRITE — Research feeds alternatives and decision: PASS — emitter redirection, separate compiler/packed oracles, immutable generations, pinned readers and explicit materialization drive alternative 3. The normal backup-rename gap is explicitly rejected, and the private exported compiler API is excluded from the proposed implementation.
- GATE-WRITE — Four architecture checklist items complete: PASS — all four required items are checked.
- GATE-WRITE — Sibling scan evidence: PASS — the checklist and Validation record the package-manifest and root/affected/publish consumer inspection, identifying the private Vite producer, nested packages and retained app capabilities. This gate reuses that supplied inventory and the prior bounded owner inspection; it does not claim a new 82-package audit.
- GATE-WRITE — At least two alternatives with pros and cons: PASS — all three alternatives state both a benefit and a concrete limitation.
- GATE-WRITE — Decision states the governing trade-off: PASS — reuse of the existing graph/emitters preserves full artifact assembly while requiring managed generations, pinned consumers and pack materialization. The two separately quoted owner decisions narrowly exempt Windows replacement atomicity and the first physical-dist migration; neither exempts complete output, exact manifests, failure reporting or subsequent Linux/macOS atomic switches.
- GATE-WRITE — New-surface placement: N/A — the plan introduces no workspace, product package, app, presentation/public interface surface or product-family/layer reclassification. Internal artifact modules reuse the current graph/execution engine and existing compiler owners, not a sibling product or parallel framework.
- GATE-WRITE — Completion criteria have TC-N prefixes: PASS — every criterion is numbered TC-01 through TC-07.
- GATE-WRITE — Distinct feature coverage: PASS — TC-01 covers complete root/affected discovery and copied-edge order; TC-02 staging and atomic/failure behavior; TC-03 independent exact emission checks; TC-04 real packed payload and all transfer/publish paths; TC-05 real release-path cold/stale/failure execution; TC-06 the retained clean framework-only acceptance; TC-07 the expressly approved migration/host exceptions and delivery. Decision additionally binds Bun output and request-time web readers to the same immutable-output obligations.
- GATE-WRITE — Criteria use command or observable behavior form: PASS — the seven criteria identify exit-0 executions, accepted/rejected payloads, generation visibility, recovery and delivering evidence. They distinguish observed real execution from planner or pure-predicate results and explicitly require Linux evidence for the Linux-only framework case.
- GATE-WRITE — No prohibited vague criterion phrases: PASS — none of the criteria uses the catalogue's prohibited completion phrases.
- GATE-WRITE — Test Plan section present: PASS — the section contains an integration strategy, framework acceptance detail and the seven-row table.
- GATE-WRITE — One test row per criterion: PASS — seven rows match TC-01 through TC-07 exactly.
- GATE-WRITE — Each test row has type and approach: PASS — each row supplies Unit/Integration/CI smoke coverage and an explicit emitter, graph, switch, tarball, release corpus, framework or migration approach; no TBD entry exists.
- GATE-WRITE — Manual-test justification: N/A — no row selects manual as its tool. Delivery readback and real emitter tests are distinguished from registry publication, which is outside this Task.
- GATE-WRITE — Tasks section and placeholder present: PASS — the unchecked entry points to the existing exact ARTIFACT-2655 Task, which remains todo with implementation unchecked.
- GATE-WRITE — Evidence Log present and initially empty: PASS — the section had no entry before this first GATE-WRITE append.
- GATE-WRITE — No body Status or Classification sections: PASS — neither prohibited heading appears; status/type remain frontmatter fields.

**Verdict reason:** All 27 criteria are satisfied or explicitly inapplicable, including the seven semantic criteria. The original complete/atomic/exact acceptance is retained subject only to the two explicit owner-authorized atomicity exceptions, also recorded in the paired Task. No-follow enumeration, physical-generation pinning, sealed-output protection, real tarball materialization, managed CI restoration and failure recovery are explicit design obligations. Carson's revision-1 ENDORSE supports the recommendation but is not substituted for runtime proof. This is GATE-WRITE only, not GATE-APPROVAL, implementation verification or delivery acceptance. No tests, scans, Git operations, fixtures, worktrees or source edits were performed by this gate.

**Judged by:** `backlog-gate-guard` independent guardian (Pascal), current conversation
**Judged document:** `.agents/spec-docs/draft/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md` — pre-append blob `a27b2d7380ee7a9b7781848958b95c1c091a36f2`, calculated from the read bytes without a Git command.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-12

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "#2655 이슈를 처리하고 origin/develop 브랜치에 머지할 때까지 반복해서 처리 완료 해줘."
**Given:** 2026-09-12, this conversation
**Review fingerprint:** 3cede04bb5d3 (review 6bc6b94d, type/tags aba2e7e1)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-12, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (3cede04bb5d3) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `7dc3ead0181f` · base `origin/develop@7dc3ead0181f` · document `.agents/spec-docs/backlog/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md` blob `ade0835c5ae9` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-12

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "backlog-gate-guard GATE-APPROVAL only. Document now .agents/spec-docs/backlog/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md. Catalogue .agents/specs/gate-catalogue.md. MainapproveDIRECT exactownergoalrecorded; judge6PASS0FAIL3PENDING. Ownercurrentexplicitexceptions 'windows 빌드의 원자성 보장 제외를 허용합니다.' and 'dist 최초 전환도 승인합니다.' bothDecisionverbatim; standingfull#2655goal+다사전승인함. SameCarsonENDORSEscope, no designchangesafterfingerprint. JudgependingandwriteonlydocEvidenceLog. No newresearch/source/Git/statusmoves/fixtures/worktrees."
**Given:** 2026-09-12, this conversation
**Review fingerprint:** 3cede04bb5d3 (review 6bc6b94d, type/tags aba2e7e1)

**Ordering check:** PASS — the preceding GATE-WRITE PASS records draft → review-ready for this exact Task/spec identity. The document now resides in backlog with `status: review-ready`. The existing mechanical APPROVAL entry does not change that input state. This append changes neither status nor location.

- GATE-APPROVAL — User has provided explicit approval in the current conversation: PASS — the current user instruction above names this exact document, confirms DIRECT approval and preapproval, and expressly retains both owner decisions. This judgement does not rely solely on the earlier quoted umbrella goal or an agent relay.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the current instruction binds the approval to ARTIFACT-2655's unchanged Carson-ENDORSE scope and its two separately authorized exceptions. Complete output, exact emitted/packed validation, failure recovery and normal Linux/macOS managed-switch atomicity remain required; neither exception is a blanket waiver.
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval: N/A — route DIRECT; no delegated class or registry extension is invoked.
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: N/A as a CLASS condition — route DIRECT; the current direct instruction, date and conversation are nevertheless recorded in the required fields above.
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: N/A — no CLASS route or class measurement is claimed.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — the L2 item is approved directly, not inferred to belong to an L0/L1 or migration class.
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: PASS — read-only hashing of the current Architecture Review and declared INFRA / cli,typescript values reproduces `3cede04bb5d3 (review 6bc6b94d, type/tags aba2e7e1)`, exactly matching the recorded approval fingerprint.
- GATE-APPROVAL — Independent architecture validation (conditional): N/A for new-surface placement — the unchanged plan introduces no new workspace, app, product surface or layer/product-family reclassification. Existing internal graph/emitter and artifact consumers retain ownership. Carson's revision-1 ENDORSE is explicitly recorded for the recommendation, including the resolved migration, Windows, CI restoration and Bun/reader findings; it is not represented as runtime proof.

**Verdict reason:** All eight route criteria pass or are explicitly inapplicable, and ordering passes. The three residual semantic criteria are resolved using the current direct instruction and existing reviewed design, without repeating source inventory or research. The paired Task remains todo with implementation unchecked; no implementation or delivery completion is claimed. No tests, scans, Git operations, fixtures, worktrees, source edits or status moves were performed.

**Judged by:** `backlog-gate-guard` independent guardian (Pascal), current conversation
**Judged document:** `.agents/spec-docs/backlog/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md`

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-12

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/7 TC ids and carries 3 checkbox task(s)
  **Required action:** one task per TC-N

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `7dc3ead0181f` · base `origin/develop@7dc3ead0181f` · document `.agents/spec-docs/todo/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md` blob `3d4e0423f87a` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-12

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-12; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (7)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 177 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 5 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md",
  "specPath": ".agents/spec-docs/todo/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md",
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
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/loop-runs/backlog-execution-orchestrator.jsonl",
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/loop-runs/user-request-gate.jsonl",
    ".agents/spec-docs/todo/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md",
    ".agents/tasks/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `7dc3ead0181f` · base `origin/develop@7dc3ead0181f` · document `.agents/spec-docs/todo/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md` blob `9cf17df83557` (untracked)
