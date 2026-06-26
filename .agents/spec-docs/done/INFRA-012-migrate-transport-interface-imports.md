---
status: done
type: INFRA
tags: [typescript]
---

# INFRA-012: Migrate agent-transport interface-type imports to agent-interface-transport (INFRA-010 L2)

> Source: INFRA-002 finding **AF-14**. Layer 2 of the INFRA-010 refactor (L1 = DATA-001, done). The user
> directed a proper, by-the-book fix.

## Problem

DATA-001 (L1) relocated the transport-facing interface-type SSOT into `@robota-sdk/agent-interface-transport`,
with `agent-framework` re-exporting them. `agent-transport` still imports those types from
`@robota-sdk/agent-framework` (across ~74 files), so the Interface Package Rule (AF-14) — implementation
packages take interface types from `agent-interface-*`, not from `agent-framework` — is still violated at
the import sites even though the SSOT moved.

**This backlog is Layer 2:** repoint `agent-transport`'s **type** imports of the moved closure from
`@robota-sdk/agent-framework` to `@robota-sdk/agent-interface-transport`. Runtime-value imports
(classes/functions/consts) and `TInteractiveSessionOptions` (intentionally retained in framework by L1)
stay imported from `@robota-sdk/agent-framework`.

**Reproduction condition:** `rg -l "from '@robota-sdk/agent-framework'" packages/agent-transport/src` →
74 files; many import moved interface types (e.g. `IInteractiveSession`) that now have their SSOT in
`agent-interface-transport`.

## Architecture Review

### Affected Scope

- `packages/agent-transport/src/**` — repoint type imports of the moved set to `agent-interface-transport`.
- No package.json change needed (`agent-transport` already depends on `agent-interface-transport`).
- NOT changed: `agent-framework` (keeps re-exporting), `agent-interface-transport` (L1), the rule/guard (L3).

### Moved-type set (import from agent-interface-transport)

The types exported by `agent-interface-transport/src/index.ts` (the L1 closure), e.g. `IInteractiveSession`,
`ICommand`, `ICommandResult`, `ICommandListEntry`, `ICommandPluginAdapter`, `ICommandInteraction`,
`IToolState`, `IUsageSnapshot`, `TPermissionResultValue`, `IInteractionChannel`, `TActionRequest`,
`IExecutionWorkspaceEntry`/`*Snapshot`/`*Filter`, `IInteractiveSessionStore`, `IResumableSessionSummary`,
`TCommandEffect`, `IExecutionResult`, the background-group + workspace + event + capability contracts, etc.

### Retained-in-framework set (keep importing from agent-framework)

Runtime values: `InteractiveSession` (class), `CommandRegistry` (class), `readSettings`, `writeSettings`,
`getUserSettingsPath`, `createProjectSessionStore`, `tokeniseSlashCommand`, `isSlashCommand`,
`isStatusLineCommandSettingsPatch`, `listResumableSessionSummaries`, `DEFAULT_STATUS_LINE_COMMAND_SETTINGS`;
and the type `TInteractiveSessionOptions` (+ its construction closure) which L1 deliberately left in framework.

### Alternatives Considered

1. **Leave imports pointing at framework (rely on re-export).** Pro: zero change. Con: AF-14 stays violated
   at the import sites — the whole point of L2. Rejected.
2. **Repoint only the type imports of the moved set; keep runtime + TInteractiveSessionOptions from framework.**
   Pro: makes the contract boundary real for the relocated types; reviewable per-file. Con: must split mixed
   imports carefully. Chosen.

### Decision

Alternative 2. Split each `agent-transport` import: moved interface types → `agent-interface-transport`;
runtime values + `TInteractiveSessionOptions` → `agent-framework`. `import type` stays `import type`.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-transport/src only; framework/interface-transport unchanged
- [x] Sibling scan 완료 — moved-type set taken verbatim from agent-interface-transport index (L1 output); runtime/retained set enumerated
- [x] 대안 최소 2개 검토 완료 — 2 alternatives above
- [x] 결정 근거 문서화 완료 — Decision records the type-vs-runtime split

## Solution

For each `agent-transport/src` file importing from `@robota-sdk/agent-framework`: move the symbols that are
in the moved-type set into an `import type { … } from '@robota-sdk/agent-interface-transport'` statement;
leave runtime values and `TInteractiveSessionOptions` importing from `@robota-sdk/agent-framework`. Then
build + typecheck + test agent-transport (and dependents), and confirm dep-direction + conformance green.

## Affected Files

- `packages/agent-transport/src/**` (import-source repointing only)

## Completion Criteria

- [x] TC-01: No `agent-transport/src` file imports a moved interface type from `@robota-sdk/agent-framework`
      — `rg` shows the moved types (e.g. `IInteractiveSession`, `ICommand`, `ICommandResult`, `TCommandEffect`)
      are imported from `@robota-sdk/agent-interface-transport`, not `@robota-sdk/agent-framework`, in agent-transport.
- [x] TC-02: Runtime values (`InteractiveSession`, `CommandRegistry`, `readSettings`, …) and
      `TInteractiveSessionOptions` are still imported from `@robota-sdk/agent-framework` (not broken).
- [x] TC-03: `pnpm build`, `pnpm typecheck`, `pnpm test` green for affected packages;
      `node scripts/harness/check-dependency-direction.mjs` + `pnpm harness:conformance` exit 0.

## Test Plan

| TC-ID | Test Type                     | Tool / Approach                                                                          | Notes            |
| ----- | ----------------------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| TC-01 | CI pipeline smoke test        | `rg` over agent-transport/src: moved types come from interface-transport                 | Command-form     |
| TC-02 | Build/typecheck assertion     | `pnpm --filter @robota-sdk/agent-transport typecheck` (runtime imports resolve)          | re-export intact |
| TC-03 | CI pipeline smoke + dep check | `pnpm build`/`typecheck`/`test`; `check-dependency-direction.mjs`; `harness:conformance` | full green gate  |

## Tasks

- [x] [`.agents/tasks/completed/INFRA-012.md`](../../tasks/completed/INFRA-012.md) — archived at GATE-COMPLETE; tasks TC-01/TC-02/TC-03 + Test Plan all `[x]`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready
Frontmatter: starts with `---`; `status: draft`; `type: INFRA` (valid 11-prefix value); `tags: [typescript]` present.
Problem: concrete symptom (`rg -l "from '@robota-sdk/agent-framework'" packages/agent-transport/src` → 74 files, verified; rule AF-14 violated at import sites); reproduction condition present; no TBD/TODO/vague single-sentence.
Architecture Review: all 4 checklist items `[x]`; sibling scan `[x]` with completion evidence (moved-type set taken verbatim from agent-interface-transport L1 index); 2 alternatives with pro/con each; Decision references the type-vs-runtime split trade-off.
Completion Criteria: TC-01/TC-02/TC-03 all TC-N prefixed; command/observable form; no banned vague terms ("works correctly", "no errors", "implemented", "displays correctly").
Test Plan: `## Test Plan` present; 3 rows for 3 TC-Ns (count matches); each row has non-empty Test Type + Tool/Approach; no "TBD"; no "manual" tool rows requiring Notes justification.
Structure: Tasks section present with placeholder; Evidence Log present and empty before this entry; no `## Status` or `## Classification` body sections.
Cross-check: dependency `@robota-sdk/agent-interface-transport: workspace:*` confirmed in agent-transport package.json; `agent-interface-transport/src/index.ts` (L1 SSOT) exists.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved
Explicit approval present: user approved the INFRA-010 3-layer decomposition (DATA-001 → INFRA-012 → INFRA-013) with "승인", directed a proper/by-the-book fix ("정석으로 제대로 수정"), and repeatedly directed continued execution ("진행해", "계속 이어서 진행해"). "승인" and "진행해" are both on the skill's explicit-approval list.
Direct & unambiguous to this spec: the approval covers the INFRA-010 decomposition that names INFRA-012 as Layer 2; spec body confirms ("Layer 2 of the INFRA-010 refactor (L1 = DATA-001, done). The user directed a proper, by-the-book fix.").
No post-approval drift: frontmatter (`status: review-ready`, `type: INFRA`, `tags: [typescript]`) and Architecture Review checklist (all `[x]`) unchanged since GATE-WRITE.
NON-COMPLIANCE check: not triggered — `## Tasks` shows `.agents/tasks/INFRA-012.md` is 미생성 (no tasks file, no implementation commits before this gate).

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-14

**Status upgrade:** approved → in-progress
Tasks file created: `.agents/tasks/INFRA-012.md` exists (created at this gate).
Path recorded in spec: `## Tasks` now links `.agents/tasks/INFRA-012.md` (replaced the 미생성 placeholder).
Tasks correspond to Completion Criteria (≥1 per TC-N): TC-01 (split moved interface types → agent-interface-transport import), TC-02 (retain runtime values + TInteractiveSessionOptions from agent-framework), TC-03 (build/typecheck/test + dep-direction + harness:conformance green) — 3 tasks for 3 TC-Ns.
Test Plan present ≥50 chars [AF-24]: tasks file includes a `## Test Plan` section with TC-01/TC-02/TC-03 verification approaches (well over 50 chars), satisfying the test-plans harness scan requirement.
NON-COMPLIANCE check: not triggered — tasks file created at this gate, no implementation commits precede it.

### [GATE-VERIFY] — ✅ PASS | 2026-06-14

**Status upgrade:** in-progress → verifying
Tasks completion: all 3 tasks in `.agents/tasks/INFRA-012.md` (TC-01/TC-02/TC-03) marked `[x]`; none blocked or pending.
Build/test (orchestrator-verified, re-confirmed): `pnpm build` pass; `pnpm typecheck` exit 0 (all packages); agent-transport tests 473/473 pass; only `packages/agent-transport/src/**` changed; package.json / pnpm-lock.yaml untouched.
TC-01 (re-run `rg`): no moved interface type (IInteractiveSession, ICommandResult, TCommandEffect, IToolState, ICommand) is imported from `@robota-sdk/agent-framework` in agent-transport/src — `rg` returned NONE; moved types are sourced from `@robota-sdk/agent-interface-transport`. The 25 files still importing from agent-framework carry only runtime values, `TInteractiveSessionOptions`, and `IBackgroundTask*` types (verified NOT exported by agent-interface-transport's index — outside the L1 moved closure, correctly retained).
TC-02: runtime values (`InteractiveSession`, `CommandRegistry`, `readSettings`, `writeSettings`, `tokeniseSlashCommand`, `isSlashCommand`) and the type `TInteractiveSessionOptions` confirmed still imported from `@robota-sdk/agent-framework`; typecheck exit 0 proves re-export boundary intact.
TC-03 (re-run): `node scripts/harness/check-dependency-direction.mjs` exit 0 ("No dependency direction violations found"); `pnpm harness:conformance` exit 0 with `dependencyDirection: pass`, `conformant: true`; no unresolved P0.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-14

**Status upgrade:** verifying → done
Scope note: spec has no `## User Execution Test Scenarios` section → User-Execution done-gate is N/A for this item (INFRA-010 L2 import-migration). Test Plan evidence (build/typecheck/test/dep-direction/conformance green) is the applicable evidence class and was captured at GATE-VERIFY; re-confirmed below.
**[GATE-COMPLETE: TC-01]** Checkbox `[x]`. Verified — `rg` over `packages/agent-transport/src` shows moved interface types (`IInteractiveSession`, `ICommand`, `ICommandResult`, `TCommandEffect`, `IToolState`) sourced from `@robota-sdk/agent-interface-transport`; none imported from `@robota-sdk/agent-framework` (GATE-VERIFY `rg` returned NONE). Test ref: Test Plan TC-01 command-form `rg` check (CI pipeline smoke).
**[GATE-COMPLETE: TC-02]** Checkbox `[x]`. Verified — runtime values (`InteractiveSession`, `CommandRegistry`, `readSettings`, `writeSettings`, `tokeniseSlashCommand`, `isSlashCommand`) and type `TInteractiveSessionOptions` still imported from `@robota-sdk/agent-framework`; `pnpm --filter @robota-sdk/agent-transport typecheck` exit 0 proves re-export boundary intact. Test ref: Test Plan TC-02 build/typecheck assertion.
**[GATE-COMPLETE: TC-03]** Checkbox `[x]`. Verified — `pnpm build`/`typecheck`/`test` green for affected packages (agent-transport 473/473); `node scripts/harness/check-dependency-direction.mjs` exit 0; `pnpm harness:conformance` exit 0 (`dependencyDirection: pass`, `conformant: true`, no unresolved P0). Test ref: Test Plan TC-03 CI smoke + dependency gate.
Spec `## Completion Criteria`: TC-01/TC-02/TC-03 all `[x]`. `## Test Plan`: all 3 TC rows carry command-form test references (no silent unaddressed TC).
Artifact actions: tasks file archived `.agents/tasks/INFRA-012.md` → `.agents/tasks/completed/INFRA-012.md` (all 3 tasks `[x]`); `## Tasks` section updated to the archived path.
**Summary:** All 3 TC-N checked with matching evidence; Test Plan fully referenced; tasks archived. GATE-COMPLETE PASS — status upgrade verifying → done authorized (frontmatter/folder move performed by backlog-pipeline, not this guard).
