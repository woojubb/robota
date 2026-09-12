---
status: done
type: INFRA
tags: [cli, typescript]
lane: L2
---

# ARTIFACT-2655: Assemble complete transactional workspace artifacts

Paired with `.agents/tasks/completed/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md`.
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

- [x] TC-01: Clean root and affected builds exit 0 with complete declared package artifacts, including private web producer and CLI copied assets; a web-only change selects and orders CLI reassembly without duplicate producer builds.
- [x] TC-02: Node, browser, types and copied web are assembled only in staging; successful managed publication on Linux/macOS is atomic, and injected emit/copy/type failure or process interruption preserves the previous complete generation with no missing-path interval during publication. Windows is exempt only from atomic replacement: validate the full generation before switching, preserve prior output for recovery, and report interrupted/failed replacement explicitly.
- [x] TC-03: Exact emitted-manifest verification rejects seeded obsolete files, removed-source outputs, missing files, byte mismatches, internal symlinks and mixed-generation copies; expectations are not derived from the directory under verification.
- [x] TC-04: Actual tarball verification rejects missing/extra/modified payloads, preserves workspace dependency transformations and CLI bin/web behavior, and binds every supported pack/publish/skip-build/CI artifact path to the same verified generation.
- [x] TC-05: The release-path corpus executes cold, stale-seeded and partial-failure cases with real emitters and real pack; relevant independent tests and required CI pass. Pure predicate tests alone do not establish this criterion.
- [x] TC-06: Current clean framework-only affected build/test exits 0 without global fallback, builds analytics/replay before the three original Issue #2653 regression files, and passes those files against fresh output; record the selected scope, commands and actual results.
- [x] TC-07: The explicitly approved initial legacy-output transition preserves the old output, reports its non-atomic interval, and supports failure/interruption recovery. Preserve Windows build compatibility under its separate atomicity-only exception. Do not apply either exception to normal Linux/macOS managed publication. All criteria are delivered to origin/develop with issue evidence.

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

| TC-ID | Test Type          | Tool / Approach                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Notes                                                                                                                                                                                                       |
| ----- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Integration        | `scripts/harness/__tests__/workspace-affected.test.mjs` — describe `workspace affected planner`, test `reassembles only transitive copied consumers and their prerequisites on an asset change`; `scripts/artifacts/__tests__/release-path.test.mjs` — top-level test `cold root execution builds real node/browser/types plus Vite copies and packs their exact payload`                                                                                                                                                | Historical local root 82/web-only 67 tasks; final CI root 82 tasks and real release corpus passed.                                                                                                          |
| TC-02 | Integration        | `scripts/artifacts/__tests__/generation-concurrent.test.mjs` — top-level test `keeps pinned pairs coherent and the current link complete during repeated real POSIX switches`; `scripts/artifacts/__tests__/emitters-build-package.test.mjs` — top-level test `propagates a real compiler failure without replacing the consumer generation`                                                                                                                                                                             | Historical macOS and current Linux execution; native Windows staging/recovery separately verified without an atomicity claim.                                                                               |
| TC-03 | Unit / Integration | `scripts/artifacts/__tests__/manifest.test.mjs` — top-level tests `compares files against compiler records, rejecting an obsolete output` and `rejects an internal symlink even when its bytes match an expected emission`; `scripts/artifacts/__tests__/emitters-build-package.test.mjs` — `rejects a modified producer against its pinned manifest rather than blessing copied bytes`                                                                                                                                  | Final CI artifact tests and actual output-contract scan of all 82 packages passed; expectations remain emitter/producer-owned.                                                                              |
| TC-04 | Integration        | `scripts/artifacts/__tests__/pack-tar.test.mjs` — top-level test `checks actual gzip tar entries against independently supplied content and mode records`; `scripts/artifacts/__tests__/publish.test.mjs` — `binds dry-run and OTP publication to the same verified tarball without directory repacking`; `scripts/artifacts/__tests__/transfer.test.mjs` — `rejects corruption in the last package before publishing the first package`                                                                                 | Real tarballs/transfer tested; registry calls in publication tests are controlled. Historical 37 public archives and 24 outside-repository installs are retained evidence, not new runs or npm publication. |
| TC-05 | CI smoke           | `scripts/artifacts/__tests__/release-path.test.mjs` — top-level tests `cold root execution builds real node/browser/types plus Vite copies and packs their exact payload`, `web-only affected rebuild removes seeded stale output and a later config edit removes obsolete entries`, `real emit failure retains the complete prior consumer and can still pack that verified generation`                                                                                                                                 | Final CI: release corpus 3/3; artifact suite 104 passed, 1 skipped. Applicable build/test checks succeeded; provenance remained owner-exempted RED.                                                         |
| TC-06 | Integration        | `packages/agent-framework/src/interactive/__tests__/interactive-session-background-tasks.test.ts` — describe `InteractiveSession background task integration`; `packages/agent-framework/src/testing/__tests__/session-log-external-payload-replay-functional.test.ts` — describe `session-log external-payload replay (framework functional)`; `packages/agent-framework/src/testing/__tests__/usage-assertion-functional.test.ts` — describe `Token-usage assertions (ANALYTICS-001) via the scripted-session harness` | Final clean Linux proof: selected 15, globalFallback=false, build 15/15, explicit three files 12/12, full affected framework tests 1792/1792 across 226 files.                                              |
| TC-07 | Integration        | `scripts/artifacts/__tests__/generation.test.mjs` — top-level tests `announces the approved non-atomic legacy transition and retains its physical backup`, `restores the legacy directory if installing the new pointer fails`, `keeps the old generation through Windows replacement failure without claiming atomicity`; `scripts/artifacts/__tests__/recovery-lock.test.mjs` — `retains a crashed recoverer record and requires quiescent claim cleanup before explicit retry`                                        | Native Windows job 103588603534 passed build and replacement/recovery. PR #2715 merged by woojubb; Issue #2655 records commit 4f3c0755. Both owner exceptions above remain verbatim and narrowly scoped.    |

### Closeout evidence preparation — 2026-09-13

Checked criteria record implementation/execution evidence, not a GATE-VERIFY or GATE-COMPLETE
judgment. Historical pending notes and gate history remain intact. This preparation performs no
product execution, status transition or archival.

- Exact tested head: `3310019a22d6bc445f9daaac4b54893b9e32276c`. Read back
  [Linux job 103588603553](https://github.com/woojubb/robota/actions/runs/34706938357/job/103588603553)
  and [Windows job 103588603534](https://github.com/woojubb/robota/actions/runs/34706938357/job/103588603534):
  both `conclusion=success`. Clean proof preceded full build; full quality, 82-package output scan,
  real artifact/pack/release-path, desktop and binary e2e steps all succeeded.
- Actual clean commands, in order: `node scripts/harness/workspace-affected-run.mjs --operation build --changed-file packages/agent-framework/src/index.ts`;
  `pnpm --filter @robota-sdk/agent-framework exec vitest run --no-cache src/interactive/__tests__/interactive-session-background-tasks.test.ts src/testing/__tests__/session-log-external-payload-replay-functional.test.ts src/testing/__tests__/usage-assertion-functional.test.ts`;
  `node scripts/harness/workspace-affected-run.mjs --operation test --changed-file packages/agent-framework/src/index.ts`.
  CI logs report 15 build tasks, 12 explicit tests, then 1792 affected tests; this supersedes the
  earlier planner-only limitation without relabeling historical macOS evidence as Linux execution.
- API confirms [PR #2715](https://github.com/woojubb/robota/pull/2715) merged into develop by
  `woojubb` at `2026-09-12T22:16:52Z`, commit `4f3c0755dd70d3830127ffecdbdc8cb7a9704abc`.
  [Issue #2655](https://github.com/woojubb/robota/issues/2655) currently records that landing and
  clean-partial acceptance. Main supplied Hume's independent ancestry/substance verification:
  238 paths and exact tree `022a449a0c887981377b35a7ed3c924af058d773`; this author did not repeat it.
- Main supplied Hume's amended-rule `MERGE VERIFIED PASS`: the confirmed-empty required projection
  was reconciled against actual declared results after local doc amendments `b97e7f9c8` and
  `d5335fdb9`, reviewed from one finding to zero. These amendments are not claimed remotely delivered.
  Workflow provenance remained owner-exempted RED, never GREEN; the separate main-owned final gates,
  lifecycle reconciliation and parent completion are not asserted here. No npm publication occurred.
- Per-TC command records below summarize observed historical/remote output. Their recorder PASS
  labels are command evidence only, not an independently judged terminal completion gate.

## User Execution Test Scenarios

Not applicable.

**Reason:** Installed CLI commands, web-monitor interactions and public API behavior are preserved.
Internal artifact storage and publication introduce no new product interaction for a user to perform.

## Tasks

- [x] `.agents/tasks/completed/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md` — GATE-COMPLETE passed; delivered by PR #2715 at `4f3c0755dd70d3830127ffecdbdc8cb7a9704abc`.

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

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-13

**Command:** `pnpm build`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Summarized observed output, not raw stdout and not a new local execution.
CI run 34706938357; head 3310019a22d6bc445f9daaac4b54893b9e32276c.
Source: https://github.com/woojubb/robota/actions/runs/34706938357/job/103588603553
CI full build: artifact workspace build: PASS tasks=82; command completed successfully.
Historical Task evidence: macOS root build 82 tasks; web-only affected build 67 tasks, exit 0, no global fallback.
Copied web producer and CLI execute once in the ordered selection; real release corpus passed 3/3 in current CI.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d5335fdb9824` · base `origin/develop@4f3c0755dd70` · document `.agents/spec-docs/active/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md` blob `15446850dc15` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-13

**Command:** `pnpm exec vitest run scripts/artifacts/__tests__`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Summarized observed output, not raw stdout and not a new local execution.
CI run 34706938357; head 3310019a22d6bc445f9daaac4b54893b9e32276c.
Source: https://github.com/woojubb/robota/actions/runs/34706938357/job/103588603553
CI command pnpm exec vitest run scripts/artifacts/__tests__ completed successfully: 104 passed, 1 skipped.
Includes real POSIX concurrent pinned-reader switches and compiler failure preservation; historical macOS evidence retained.
Windows job 103588603534 reports native generation replacement/recovery success; Windows atomicity remains exempt.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d5335fdb9824` · base `origin/develop@4f3c0755dd70` · document `.agents/spec-docs/active/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md` blob `956692f56327` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-13

**Command:** `pnpm exec vitest run scripts/artifacts/__tests__`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Summarized observed output, not raw stdout and not a new local execution.
CI run 34706938357; head 3310019a22d6bc445f9daaac4b54893b9e32276c.
Source: https://github.com/woojubb/robota/actions/runs/34706938357/job/103588603553
CI artifact tests completed successfully: 104 passed, 1 skipped.
Manifest, independent emitter-record, modified-producer, stale-output and internal-link rejection tests are included.
Actual output-contract scan: Build output contract check passed for 82 package(s), dist/ read on 82.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d5335fdb9824` · base `origin/develop@4f3c0755dd70` · document `.agents/spec-docs/active/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md` blob `ffbf0fb1e4ea` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-13

**Command:** `pnpm exec vitest run scripts/artifacts/__tests__`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Summarized observed output, not raw stdout and not a new local execution.
CI run 34706938357; head 3310019a22d6bc445f9daaac4b54893b9e32276c.
Source: https://github.com/woojubb/robota/actions/runs/34706938357/job/103588603553
CI artifact tests completed successfully: 104 passed, 1 skipped; real tarball/verified publication boundary/transfer cases included.
Task historical evidence: 37 public verified archives, 24 outside-repository tarball installations, 72 Mode A/B/C assertions.
Publication tests use controlled registry commands; no npm publication was performed or newly authorized.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d5335fdb9824` · base `origin/develop@4f3c0755dd70` · document `.agents/spec-docs/active/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md` blob `3fb5e7a04bf7` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-13

**Command:** `pnpm exec vitest run scripts/artifacts/__tests__`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
Summarized observed output, not raw stdout and not a new local execution.
CI run 34706938357; head 3310019a22d6bc445f9daaac4b54893b9e32276c.
Source: https://github.com/woojubb/robota/actions/runs/34706938357/job/103588603553
CI command pnpm exec vitest run scripts/artifacts/__tests__ completed successfully: 104 passed, 1 skipped.
release-path.test.mjs: 3 tests passed (cold real assembly/pack; stale web/config rebuild; real emit failure preserves prior packable generation).
Full quality, output scan, desktop and binary e2e steps succeeded. Provenance is separately owner-exempted RED, not green.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d5335fdb9824` · base `origin/develop@4f3c0755dd70` · document `.agents/spec-docs/active/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md` blob `35210d5d7050` (modified)

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-09-13

**Command:** `node scripts/harness/workspace-affected-run.mjs --operation test --changed-file packages/agent-framework/src/index.ts`
**Exit:** 0
**Output:** (last 7 of 7 line(s))

```
Summarized observed output, not raw stdout and not a new local execution.
CI run 34706938357; head 3310019a22d6bc445f9daaac4b54893b9e32276c.
Source: https://github.com/woojubb/robota/actions/runs/34706938357/job/103588603553
Clean framework proof: packages=15, globalFallback=false; analytics/replay present; build PASS tasks=15 n/a=0.
Three explicit original regression files with --no-cache: 3 files passed, 12 tests passed.
Full affected test command: 226 files passed, 1792 tests passed; workspace-affected-run: PASS tasks=1 n/a=0.
Clean proof ran 2026-09-12T17:01:41Z–17:03:03Z before the full workspace build.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d5335fdb9824` · base `origin/develop@4f3c0755dd70` · document `.agents/spec-docs/active/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md` blob `8afb9c607151` (modified)

### [GATE-COMPLETE: TC-07] — ✅ PASS | 2026-09-13

**Command:** `gh api repos/woojubb/robota/pulls/2715 --jq '{merged,merged_at,merged_by:.merged_by.login,merge_commit_sha,head:.head.sha,base:.base.ref}'`
**Exit:** 0
**Output:** (last 8 of 8 line(s))

```
Summarized observed API output plus attributed existing evidence; not a new test or gate judgment.
PR API: merged=true; merged_by=woojubb; merged_at=2026-09-12T22:16:52Z; base=develop.
head=3310019a22d6bc445f9daaac4b54893b9e32276c; merge_commit_sha=4f3c0755dd70d3830127ffecdbdc8cb7a9704abc.
Source: https://github.com/woojubb/robota/pull/2715 ; Issue #2655 body records this landing.
Windows https://github.com/woojubb/robota/actions/runs/34706938357/job/103588603534: package builds and native generation replacement/recovery success.
Hume independently verified 238 paths and tree 022a449a0c887981377b35a7ed3c924af058d773 (supplied by main).
Both atomicity exceptions retained; subsequent POSIX managed publication is not exempted. Provenance remained owner-exempted RED.
Local doc amendments b97e7f9c8+d5335fdb9 and amended-rule MERGE VERIFIED PASS are not a remote-delivery claim or this author's gate judgment.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d5335fdb9824` · base `origin/develop@4f3c0755dd70` · document `.agents/spec-docs/active/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md` blob `c7726711fac1` (modified)

### [GATE-VERIFY] — ✅ PASS | 2026-09-13

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — Ordering: PASS — the last GATE-IMPLEMENT entry is PASS (2026-09-12); the document is in `active/` with `status: in-progress`.
- GATE-VERIFY — Every Task Plan item is complete: PASS — the exact paired Task's `## Plan` has 3/3 `[x]` items, covering design/TC-07, implementation/TC-01–04 and verification/TC-05–06.
- GATE-VERIFY — No Plan item is blocked or pending: PASS — none of those three items is blocked, pending or unchecked. Historical pending notes outside `## Plan` are not current Plan items.
- GATE-VERIFY — Build passes for all affected packages: PASS — independently read job 103588603553 API and logs: head `3310019a22d6bc445f9daaac4b54893b9e32276c`, conclusion `success`; actual `pnpm build` reports `artifact workspace build: PASS tasks=82`. Earlier clean framework-only build reports `PASS tasks=15 n/a=0`.
- GATE-VERIFY — Tests pass for all affected packages: PASS — the same job's full `pnpm test` child reports `test (exit 0)`; typecheck/lint also exit 0. Clean framework proof passed 12 explicit tests and 1792 affected tests. Additional artifact tests passed 104 with 1 explicit skip, including release corpus 3/3; this is not a zero-skip claim.

**Verdict reason:** All four catalogue criteria and ordering pass. The two mechanical residues are wording mismatches: evaluator patterns expect “All tasks” and “No tasks”, while the catalogue specifies “Every item in the Plan section” and “No Plan item”. Direct inspection resolves both without changing the matcher or the Task.

**Evidence source:** https://github.com/woojubb/robota/actions/runs/34706938357/job/103588603553 — API/log readback only, no product rerun. Read-only diffs from the tested head to local HEAD and from HEAD to the current tracked tree contain only governance/record documents, no product/build/test implementation change. Workflow provenance remains owner-exempted RED, not a green-workflow claim. This entry judges GATE-VERIFY only; it does not judge GATE-COMPLETE, change status/location, authorize publication or close the parent.

**Judged by:** `backlog-gate-guard` independent guardian (Carson), current conversation
**Judged at:** HEAD `d5335fdb982446feea0dce9618d367e318244289` · base `origin/develop@4f3c0755dd70d3830127ffecdbdc8cb7a9704abc` · document `.agents/spec-docs/active/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md` blob `0bf07a63d10e0226534562132066cd3e5d1a82d8` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-13

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-13; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 7/7 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (7)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (7) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (7) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 7/7 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (7) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 3/3 tasks `[x]` in .agents/tasks/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d5335fdb9824` · base `origin/develop@4f3c0755dd70` · document `.agents/spec-docs/active/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md` blob `b3d2eef28200` (modified)
