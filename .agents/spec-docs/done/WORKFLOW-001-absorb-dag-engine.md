---
status: done
type: INFRA
tags: [cli, typescript]
---

# WORKFLOW-001: Absorb the DAG workflow engine into robota

## Problem

The DAG/workflow engine lives in a separate source repository (38 `@robota-sdk/dag-*` packages + 3 apps,
pnpm 8.15.4, self-contained — no dependency on robota's `@robota-sdk/agent-*`). It is to be **absorbed
into the `robota` monorepo** and the standalone repo retired; agent-cli will later surface it as a
`/workflows` command. DAG is a standalone multi-surface product (CLI, MCP server, scheduler, persistence
adapters), so the absorption brings the whole backend engine, not just what robota's CLI embeds.

Two blockers prevent a straight copy into the repo:

1. **The external-runtime coupling is baked into the core, not just a leaf.** The engine's
   runtime-provider interface and workflow-file format
   (`dag-core/src/types/{runtime-provider,workflow-file}.ts`, several `dag-framework/src/*`) carry
   external-runtime-shaped concepts; `dag-cli/src/providers/resolve-provider.ts` imports the
   external-runtime client. Absorbing the engine requires decoupling that runtime and replacing it with
   the native in-process provider, then reconciling per-package licenses to the repo standard.
2. **Non-source material must stay out of scope.** Non-source material (local environment files,
   internal tooling) was out of scope and must not be copied into the repo.

Reproduction: copying the standalone repo wholesale into `robota/packages/` would carry the
external-runtime-derived API surface and non-source material into the monorepo.

## Architecture Review

### Affected Scope

**Absorbed (36 workspace members → `robota/packages/`, flat, no rename):**

- Engine/core (10): `dag-core`, `dag-framework`, `dag-runtime`, `dag-worker`, `dag-node`, `dag-builder`,
  `dag-projection`, `dag-cost`, `dag-orchestration-client`, `dag-api`.
- Surfaces (3): `dag-cli`, `dag-mcp-server` (standalone MCP use), `dag-scheduler`.
- Adapters (2): `dag-adapters-local`, `dag-adapters-sqlite` (persistence).
- Nodes (21): all `dag-node-*` under `packages/dag-nodes/*`.

**Excluded (out of scope, kept in the origin repository):**

- The external-runtime provider adapter — outbound external-runtime client/wrapper; kept in the origin
  repository for future re-integration as an isolated, version-pinned adapter.
- `apps/dag-runtime-server` — inbound external-runtime server; **deferred to WORKFLOW-002**, which
  redesigns its API to a robota-native execution contract (R1) before it enters the repo.
- The visual-designer UI packages and the internal docs site were out of scope.

**De-wire / renativize (in robota's working tree, pre-first-commit):**

- `dag-cli/src/providers/resolve-provider.ts` + `dag-cli/package.json` — remove the external-runtime
  provider branch + dependency (sole importer of the external-runtime provider adapter).
- `dag-core/src/types/{runtime-provider,workflow-file}.ts`, `dag-core/src/index.ts`,
  `dag-framework/src/{local-dag-runtime-provider,types,create-dag-framework,default-node-registry}.ts` —
  renativize external-runtime-shaped concepts to a robota-native model.

**robota-side:** `pnpm-workspace.yaml` (flat `packages/*` already admits `dag-*`), root `tsconfig.json`
(also fix its pre-existing stale refs to non-existent `agent-provider-openai`/`agent-team`), per-package
`license` reconciliation, harness scans validated at the enlarged package count.

### Alternatives Considered

1. **Copy clean into robota's working tree, renativize the external runtime before the first commit
   (chosen).** Pro: the origin repository is untouched (adapter retained there); git history never
   contains external-runtime or non-source material. Con: core renativization must be complete +
   verified before the absorption commit is pushed (TC-02 gate).
2. **Strip the external runtime in the origin repository first, then copy.** Pro: single clean source.
   Con: mutates the to-be-retired repo and would delete the adapter retained there. Rejected.
3. **git-subtree/filter-repo to preserve dag history.** Pro: keeps commit history. Con: drags the
   external-runtime-laden history into robota. Rejected.
4. **Scope only to dag-cli's embed closure.** Pro: minimal. Con: DAG is a standalone product (MCP
   server, scheduler, sqlite) — the CLI-only closure drops surfaces the product needs. Rejected (user).
5. **Bring `dag-runtime-server` now (external-runtime API) and renativize later.** Con: lands the
   external-runtime surface in history, violating the clean-history invariant. Rejected — deferred whole
   to WORKFLOW-002 instead.

### Decision

Alternative 1, scoped to the **36-member DAG backend**: selective copy into robota's working tree,
renativize the external runtime out of core + CLI, verify clean (no external-runtime name, no
out-of-scope material) before the first commit. `dag-runtime-server` (R1 native redesign) and the
`/workflows` CLI command are **separate follow-ups** (WORKFLOW-002, WORKFLOW-003) so the bulk absorption
is not blocked on new API design and history stays clean.

Validated (wide-blast-radius, history-irreversible): (a) **Reachability** — absorbed
`@robota-sdk/dag-*` share robota's scope with no collision against `@robota-sdk/agent-*`; flat
`packages/*` glob + `listWorkspaceScopes` single-segment matcher admit `packages/dag-*`. (b) **Capability
preservation** — `local` in-process provider is already the default; excluding the external-runtime
provider loses only opt-in external-runtime execution (adapter retained in the origin repository).
(c) **Adversarial pass** — failure modes: external-runtime name leaks into history (TC-02/03 commit-clean
gate), out-of-scope material commit (excluded, TC-04), dangling deps to excluded provider/designer
packages (TC-08), harness breakage at the enlarged count (TC-07). This **reverses** the prior
`feedback_runtime_orchestrator_api_boundary` memory ("runtime API immutable") → updated to native-first
at completion.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — Affected Scope (absorb 36, exclude 5, de-wire sites, robota-side).
- [x] Sibling scan 완료 — 전수 조사: 38 패키지 + 3 앱, dag-cli 의존 폐쇄(dep+devDep) 계산, 외부 런타임 결합도(provider 1 + server 1 + core types 침투) 확인.
- [x] 대안 최소 2개 검토 완료 — 5개 (copy-clean / strip-first / subtree / cli-closure-only / bring-server-now).
- [x] 결정 근거 문서화 완료 — Decision: validated reachability + capability + adversarial; runtime-server/​CLI-command 후속 분리; 외부 런타임 native-first 전환.

## Solution

Clean-history invariant: nothing containing the external-runtime name or out-of-scope material is ever
committed to `robota`.

- **Phase A — Exclusion manifest.** Freeze the absorb set (36) and exclusion set (5). No file changes.
- **Phase B — Copy into robota working tree (uncommitted).** Copy the 36 `dag-*` packages into
  `robota/packages/`; copy none of the excluded items; the external-runtime provider adapter enters
  neither workspace nor any `package.json`.
- **Phase C — Renativize the external runtime (working tree, pre-commit).** Replace
  external-runtime-shaped concepts in `dag-core`/`dag-framework` with a robota-native runtime-provider +
  workflow-file model; remove the external-runtime branch from `dag-cli/resolve-provider.ts`. Gate:
  `rg -i` for the external-runtime name over `packages/dag-*` returns empty.
- **Phase D — License + workspace + harness.** Set absorbed `license` to robota's; fix stale root
  `tsconfig.json` refs; confirm workspace globs + harness scans.
- **Phase E — Verify green & first clean commit.** `pnpm install`, `-w typecheck`, `dag-*` `test`,
  `harness:scan` all green; THEN commit (first commit is external-runtime-free and free of out-of-scope
  material).
- **Follow-ups (separate specs):** WORKFLOW-002 — native `dag-runtime-server` API (R1) + absorb it;
  WORKFLOW-003 — `/workflows` agent-cli command; plus update the
  `feedback_runtime_orchestrator_api_boundary` memory/rule to native-first and retire the origin repo.

## Affected Files

- New: `robota/packages/dag-*/**` (36 absorbed), workspace/tsconfig/harness adjustments.
- Edited (de-wire): `dag-core/src/types/{runtime-provider,workflow-file}.ts`, `dag-core/src/index.ts`,
  `dag-framework/src/{local-dag-runtime-provider,types,create-dag-framework,default-node-registry}.ts`,
  `dag-cli/src/providers/resolve-provider.ts`, `dag-cli/package.json`.
- Edited (robota): `pnpm-workspace.yaml`, root `tsconfig.json` (stale refs).
- Excluded (never copied): the external-runtime provider adapter, `dag-runtime-server`, the
  visual-designer UI packages, the internal docs site, and non-source material (local environment files,
  internal tooling) — all out of scope.

## Completion Criteria

- [x] TC-01: `pnpm install` exit 0 + `pnpm --filter "@robota-sdk/dag-*" typecheck` exit 0 with all 36 absorbed `dag-*` packages present (after de-wiring + a TS2589 deep-instantiation fix in `dag-node/src/utils/node-descriptor.ts` + version-skew test fixes). Verified 2026-06-30.
- [x] TC-02: `rg -i` for the external-runtime name over `packages/dag-*` → **0 matches** (external runtime de-wired from core + framework + CLI/MCP/studio; the external port-spec type → `INodePortSpec`).
- [x] TC-03: excluded packages absent; `rg -l` for the external-runtime provider adapter / excluded package names over `packages/dag-*` → 0 (dead external-runtime plumbing + all excluded-package references removed/reworded).
- [x] TC-04: no out-of-scope material (local environment files, internal tooling) in `packages/dag-*` (verified by find; none copied).
- [x] TC-05: `rg '"license": "MIT"' packages/dag-*/package.json packages/dag-nodes/*/package.json` → 0; all 36 carry `AGPL-3.0-only OR LicenseRef-Commercial`.
- [x] TC-06: `pnpm --filter "@robota-sdk/dag-*" test` → exit 0 (dag-cli 985 tests + all packages green).
- [x] TC-07: `pnpm harness:scan` → exit 0 (all 38 scans green at the enlarged count — required tsdown devDep + workspace alignment + project-structure/capability-placement registration + SPEC path/surface fixes + deprecated-alias migration + orphan-export baseline + doc renames).
- [x] TC-08: `pnpm --filter "@robota-sdk/dag-*" exec true` → exit 0 (no unmet workspace deps).

## Test Plan

Strategy (INFRA + cli/typescript): mechanical command-form checks only — workspace install/typecheck,
`rg` presence/absence gates for the external-runtime name and out-of-scope material, license assertion,
package test run, and `harness:scan` smoke. No `manual` rows; every criterion is mechanically checkable.

| TC-ID | Test Type | Tool / Approach                                             | Notes                                         |
| ----- | --------- | ----------------------------------------------------------- | --------------------------------------------- |
| TC-01 | INFRA     | `pnpm install && pnpm -w typecheck` exit 0                  | absorbed packages compile in robota           |
| TC-02 | RULE      | `rg -i` external-runtime name absence over `packages/dag-*` | external runtime fully de-wired from core+CLI |
| TC-03 | RULE      | `ls` absent + `rg -l` no dangling ref                       | excluded packages gone, no broken imports     |
| TC-04 | SECURITY  | `git ls-files \| rg` absence of out-of-scope material       | no out-of-scope material committed            |
| TC-05 | RULE      | `rg '"license"'` over absorbed package.json                 | license reconciled to robota's                |
| TC-06 | BEHAVIOR  | `pnpm --filter '@robota-sdk/dag-*' test` exit 0             | absorbed tests pass                           |
| TC-07 | INFRA     | `pnpm harness:scan` exit 0                                  | workspace consistency at enlarged count       |
| TC-08 | INFRA     | `pnpm --filter '@robota-sdk/dag-*' exec -- true`            | no unmet deps to excluded packages            |

## Tasks

- [ ] `.agents/tasks/WORKFLOW-001.md` — 작성 완료 (Phase A–E → TC-01..TC-08 매핑, Test Plan 포함). 구현 진행은 해당 파일에서 추적.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-30

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` present; `type: INFRA` (valid 11-prefix value); `tags: [cli, typescript]` present.
- Problem: concrete symptom (external runtime baked into `dag-core`/`dag-framework` core types + `resolve-provider.ts`, license reconciliation to the repo standard, out-of-scope material) + reproduction condition ("copying the standalone repo wholesale into robota/packages/ would carry the external-runtime-derived API surface + out-of-scope material into the monorepo"); no TBD/TODO/vague.
- Architecture Review: Affected Scope present (absorb 36 / exclude 5 / de-wire sites / robota-side); all 4 checklist items `[x]`; Sibling scan `[x]` with completion evidence (full survey: 38 packages + 3 apps, dependency-closure, external-runtime coupling mapped); 5 Alternatives each with Pro/Con (≥2 required); Decision references the trade-off (clean history vs. pre-commit renativization gate).
- Completion Criteria: 8 items, all TC-N prefixed (TC-01..TC-08), each command/observable form; no banned vague language ("works correctly"/"no errors"/"implemented"/"displays correctly") found.
- Test Plan: `## Test Plan` present; 8 TC-N rows (TC-01..TC-08); each has non-empty Test Type + Tool/Approach; no "manual" rows (manual-justification rule vacuously satisfied).
- TC-N count matches: Completion Criteria 8 = Test Plan 8.
- Structure: Tasks section present with placeholder; Evidence Log present and empty before this run; no `## Status`/`## Classification` sections in body.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-30

**Status upgrade:** review-ready → approved

- Prior gate: GATE-WRITE shows ✅ PASS (2026-06-30) in Evidence Log; input `status: review-ready` + `backlog/` folder match the expected input stage — precondition satisfied.
- Explicit approval: user gave verbatim approval in the current session — "그래 이거 승인하는데" ("Yes, I approve this"). "승인" matches the explicit-approval list.
- Directed at this spec: approval followed review of the finalized scope (absorb 36 DAG packages; exclude the external-runtime provider adapter / `dag-runtime-server` / the visual-designer UI packages / the internal docs site; de-wire the external runtime from core + CLI; runtime-server R1 and /workflows command deferred to WORKFLOW-002/003), which matches this document's Architecture Review and Decision — direct, unambiguous, item-specific.
- No post-approval drift: Architecture Review and frontmatter `type: INFRA` / `tags: [cli, typescript]` unchanged after approval.
- NON-COMPLIANCE trigger clear: no implementation work started — Tasks section still placeholder, no `.agents/tasks/WORKFLOW-001.md` created, no code edits/commits.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-30

**Status upgrade:** approved → in-progress

- Prior gate: GATE-APPROVAL shows ✅ PASS (2026-06-30) in Evidence Log; input `status: approved` + `todo/` folder match the expected input stage — precondition satisfied.
- Tasks file created: `.agents/tasks/WORKFLOW-001.md` exists (was ABSENT before this run).
- Tasks file path recorded in spec `## Tasks` section: placeholder replaced with a reference to `.agents/tasks/WORKFLOW-001.md`.
- Spec pointer present in tasks file: `Spec: .agents/spec-docs/active/WORKFLOW-001-absorb-dag-engine.md`.
- TC coverage: phased tasks (Phase A–E from the Solution section) map to every Completion Criterion — TC-01..TC-08 each covered by ≥1 task; an explicit "TC Coverage Map" table confirms one-task-per-TC minimum (TC-01→B,E; TC-02→C; TC-03→B,C; TC-04→A,E; TC-05→D; TC-06→E; TC-07→D,E; TC-08→D).
- Test Plan section: `## Test Plan / 검증` present in the tasks file, well over 50 chars (command-form verification for all 8 TCs), satisfying the `test-plans` harness scan [AF-24].
