---
status: done
type: DATA
tags: [typescript]
---

# DATA-001: Extract transport-facing interface types to agent-interface-transport (INFRA-010 L1)

> Source: INFRA-002 audit finding **AF-14** (Interface Package Rule under-enforced). Layer 1 of the
> INFRA-010 refactor (decomposed per user request into DATA-001 → INFRA-012 → INFRA-013). The user
> directed a proper, by-the-book fix regardless of size.

## Problem

The Interface Package Rule (`.agents/project-structure.md`) says implementation packages take interface
types from `agent-interface-*`, not from `agent-framework`. In reality `agent-transport` imports ~18
interface types (`IInteractiveSession` ×22, `ICommand`, `ICommandResult`, `ICommandPluginAdapter`,
`ICommandInteraction`, `IToolState`, `TCommandEffect`, `IExecutionWorkspaceEntry`,
`IInteractiveSessionStore`, `IResumableSessionSummary`, `IUsageSnapshot`, `TInteractiveSessionOptions`,
`TPermissionResultValue`, `IInteractionChannel`, `TActionRequest`, `ICommandListEntry`, …) directly from
`@robota-sdk/agent-framework` across ~74 files (AF-14). The transport→framework edge is allowed, so the
dependency-direction check passes, but the documented contract boundary is fiction.

The fix is a 3-layer refactor; **this backlog is Layer 1**: relocate the SSOT of those contract types
into `agent-interface-transport` (the contract package both `agent-framework` and `agent-transport`
share), with `agent-framework` re-exporting them so nothing else changes yet. Layer 2 (INFRA-012)
migrates `agent-transport`'s imports; Layer 3 (INFRA-013) enforces the rule mechanically.

**Reproduction condition:** the transport-facing interface types are defined under `packages/agent-framework/src/**`,
not in `agent-interface-transport`.

## Architecture Review

### Affected Scope

- `packages/agent-interface-transport/` — new home (SSOT) for the transport-facing contract types; gains
  one-way dependencies on `@robota-sdk/agent-core` (and `@robota-sdk/agent-executor` if the closure
  references runtime-layer types such as background-task contracts) for the lower-layer types the
  contracts reference.
- `packages/agent-framework/` — type definitions relocated; framework re-exports them from
  `agent-interface-transport` (SSOT moves, public surface unchanged).
- NOT changed here: `agent-transport` import sites (INFRA-012), the rule prose + guard (INFRA-013).

### Alternatives Considered

1. **Leave types in agent-framework; relax the rule.** Pro: zero code change. Con: the user explicitly
   rejected the minimal path — the contract package should own the contract. Rejected.
2. **Move only the agent-core-only-dependent subset.** Pro: smaller, no agent-executor dep. Con: leaves
   `IInteractiveSession` (the biggest leak, 22 imports) in framework, so AF-14 stays mostly open;
   half-measure. Rejected.
3. **Move the full transport-consumed contract closure to agent-interface-transport, allowing one-way
   deps on agent-core (and agent-executor for runtime-layer contract types).** Pro: the contract package
   genuinely owns the shared surface; proper foundation; sets up a clean L2 migration. Con: larger move,
   adds interface→core/executor edges. Chosen (per the user's "정석으로 제대로" direction).

### Decision

Alternative 3. `agent-interface-transport` becomes the SSOT for the transport-facing contract types and
takes one-way dependencies on `agent-core` (always) and `agent-executor` (only if the moved closure
references its runtime contracts). These are clean one-way edges — `dependency-direction.mjs` forbids
only bidirectional deps, pass-through re-exports, agent-core deps, and plugin-layer deps; none apply.
`agent-framework` re-exports the moved types so its public surface and all current consumers
(incl. agent-transport, still importing from framework) are unaffected until L2.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-interface-transport (new SSOT), agent-framework (relocate + re-export)
- [x] Sibling scan 완료 — transport import surface enumerated (INFRA-002 AF-14); closure roots traced from `i-interactive-session.ts`
- [x] 대안 최소 2개 검토 완료 — 3 alternatives above
- [x] 결정 근거 문서화 완료 — Decision records the contract-ownership rationale + the allowed one-way edges

## Solution

1. Compute the transitive closure of the transport-consumed interface types that are currently defined
   in `agent-framework/src/**` (exclude types already owned by `agent-core`/`agent-executor` — those are
   imported, not moved).
2. Move those type definitions into `agent-interface-transport/src/**` (grouped coherently, e.g.
   `command-contracts.ts`, `session-contracts.ts`, `interaction-contracts.ts`), exported from its
   `index.ts`. Add `@robota-sdk/agent-core` (+ `agent-executor` if needed) to its `package.json` deps.
3. In `agent-framework`, replace the moved definitions with re-exports from
   `@robota-sdk/agent-interface-transport`, so every existing framework import path keeps working.
4. Build `agent-interface-transport` then `agent-framework`; run typecheck + tests; confirm
   `dependency-direction.mjs` + `harness:conformance` stay green.

## Affected Files

- `packages/agent-interface-transport/src/**` (NEW contract modules + index export)
- `packages/agent-interface-transport/package.json` (add agent-core [+ agent-executor] dep)
- `packages/agent-framework/src/**` (relocated definitions → re-exports)
- (NOT `agent-transport` — that is INFRA-012)

## Completion Criteria

- [x] TC-01: The transport-facing contract types are exported from `@robota-sdk/agent-interface-transport`
      (its `index.ts` exports `IInteractiveSession`, `ICommand`, `ICommandResult`, `ICommandPluginAdapter`,
      `ICommandInteraction`, `TCommandEffect`, and the rest of the moved closure) — verified by a type
      import test in `agent-interface-transport`.
- [x] TC-02: `agent-framework` re-exports the moved types (its existing public import paths still resolve)
      — `pnpm --filter @robota-sdk/agent-framework build` + `pnpm --filter @robota-sdk/agent-framework typecheck`
      pass, and `pnpm --filter @robota-sdk/agent-interface-transport build` passes.
- [x] TC-03: `pnpm build`, `pnpm typecheck`, `pnpm test` are green for all affected packages, and
      `node scripts/harness/check-dependency-direction.mjs` + `pnpm harness:conformance` exit 0
      (no new direction violation; interface→core/executor are allowed one-way edges).

## Test Plan

| TC-ID | Test Type                     | Tool / Approach                                                                          | Notes                       |
| ----- | ----------------------------- | ---------------------------------------------------------------------------------------- | --------------------------- |
| TC-01 | vitest-expect-type / tsd      | type import test in agent-interface-transport asserting the exports                      | DATA + typescript           |
| TC-02 | Build/typecheck assertion     | `pnpm --filter` build + typecheck for interface-transport & framework                    | re-export surface unchanged |
| TC-03 | CI pipeline smoke + dep check | `pnpm build`/`typecheck`/`test`; `check-dependency-direction.mjs`; `harness:conformance` | full green gate             |

## Tasks

- Tasks file: [`.agents/tasks/completed/DATA-001.md`](../../tasks/completed/DATA-001.md) — archived at GATE-COMPLETE (TC-01, TC-02, TC-03 + Test Plan; all tasks `[x]`).

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready
Frontmatter: `---` block present; `status: draft`; `type: DATA` (valid 11-prefix value); `tags: [typescript]` present.
Problem: concrete symptom (enumerated interface types imported from `agent-framework` across ~74 files, AF-14) + reproduction condition (types defined under `packages/agent-framework/src/**` not in `agent-interface-transport`); no TBD/TODO/vague text.
Architecture Review Checklist: all 4 items `[x]`; Sibling scan `[x]` with evidence (transport import surface enumerated INFRA-002 AF-14, closure roots traced from `i-interactive-session.ts`); 3 Alternatives each with Pro/Con; Decision references contract-ownership trade-off + allowed one-way edges.
Completion Criteria: all items use TC-N prefix (TC-01/02/03); each covers a distinct feature (interface export, framework re-export, CI/dep gate); all Command/Observable form; no banned phrases.
Test Plan: `## Test Plan` present; 3 rows for 3 TC-N (count matches); every row has non-empty Test Type + Tool/Approach, no TBD; no row uses "manual" tool so Notes-justification N/A.
Structure: Tasks section with placeholder present; Evidence Log present and empty before this run; no `## Status`/`## Classification` body sections.
TC-N count: Completion Criteria = 3, Test Plan = 3 — match confirmed.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved
Explicit approval present in current conversation: user approved the INFRA-010 decomposition into 3 layers (DATA-001 → INFRA-012 → INFRA-013) with "승인" — a listed explicit-approval phrase.
Direct & unambiguous, directed at this item: on the agent-interface-transport dependency-contract-change question the user answered verbatim — "크게 수정하더라도 제대로 정석으로 수정해야 함. 레거시는 중요한 판단근거가 아니며 수정해야 한다면 제대로 수정하면 됩니다" (do it properly/by-the-book even if large; legacy is not a deciding factor). This authorizes DATA-001's chosen Alternative 3 (full transport-consumed contract closure move into agent-interface-transport + one-way interface→core/executor deps).
No post-approval drift: frontmatter (`status: review-ready`, `type: DATA`, `tags: [typescript]`) and Architecture Review section unchanged since GATE-WRITE (2026-06-13); neither type/tags nor the Architecture Review were modified after approval.
NON-COMPLIANCE check clear: no implementation started — `.agents/tasks/DATA-001.md` not yet created (deferred to post-approval per Tasks section) and no Affected Files modified.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress
Tasks file created: `.agents/tasks/DATA-001.md` exists (verified on disk).
Tasks file path recorded in spec `## Tasks` section: linked as `.agents/tasks/DATA-001.md`.
Tasks correspond to Completion Criteria: one task per TC-N — TC-01 (relocate closure → agent-interface-transport + type import test), TC-02 (agent-framework re-export + build/typecheck), TC-03 (full build/typecheck/test + dependency-direction + harness:conformance gate); 3 tasks for 3 TC-N — match confirmed.
Test Plan section present in tasks file: `## Test Plan` with 918 chars (≥50) including a 3-row TC table — satisfies the `test-plans` harness scan requirement [AF-24].
NON-COMPLIANCE check clear: no implementation commits exist ahead of the tasks file — tasks file created at this gate, no source edits made.

### [GATE-VERIFY] — ✅ PASS | 2026-06-14

**Status upgrade:** in-progress → verifying
Tasks completion: all 3 tasks in `.agents/tasks/DATA-001.md` are `[x]` (TC-01, TC-02, TC-03); none blocked/pending.
Completion Criteria: all 3 spec checkboxes `[x]` (TC-01/02/03).
TC-01 (transport-facing contract closure exported from agent-interface-transport): `packages/agent-interface-transport/src/index.ts` exports the full closure — `IInteractiveSession`, `ICommand`, `ICommandResult`, `ICommandPluginAdapter`, `ICommandInteraction`, `TCommandEffect`, plus `ICommandListEntry`, `IInteractionChannel`, `TActionRequest`, `IExecutionWorkspaceEntry`, `IInteractiveSessionStore`, `IResumableSessionSummary`, `IUsageSnapshot`, `IToolState`, `TPermissionResultValue`, `IExecutionResult`, and the rest — grouped into `command-contracts.ts`, `session-contracts.ts`, `interaction-contracts.ts`, `workspace-contracts.ts`, `event-contracts.ts`, `background-group-contracts.ts`, `capability-contracts.ts`. `package.json` carries one-way deps on `@robota-sdk/agent-core` + `agent-executor` + `agent-session`. Type-import test present: `src/__tests__/contracts.test.ts` (expectTypeOf assertions over the closure) → `pnpm --filter @robota-sdk/agent-interface-transport test` 5/5 passed.
TC-02 (agent-framework re-exports moved types; existing import paths resolve): framework re-exports verified via `grep` — e.g. `command-api/effects.ts` (`TCommandEffect`), `command-api/types.ts` (`ICommand`/`ICommandSource`), `interactive/i-interactive-session.ts` (`IInteractiveSession`/`IExecutionResult`), `interaction/IInteractionChannel.ts` (`IInteractionChannel`), `interactive/types.ts` (comment: "SSOT relocated to @robota-sdk/agent-interface-transport (DATA-001); re-exported here"). agent-framework typecheck: Done (full `pnpm typecheck` exit 0).
TC-03 (full build/typecheck/test + dep-direction + conformance green): re-ran `pnpm typecheck` → exit 0 (all packages incl. agent-transport, agent-cli, agent-web Done); `node scripts/harness/check-dependency-direction.mjs` → "No dependency direction violations found", exit 0; `pnpm harness:conformance` → `conformant: true`, `dependencyDirection: pass`, exit 0; `--filter @robota-sdk/agent-framework test` → 924/924 (orchestrator-verified). No new direction violation — interface→core/executor/session are allowed one-way edges.
Scope carve-out recorded (acceptable): `TInteractiveSessionOptions` was intentionally NOT moved — its closure (`ICreateSessionOptions`, `IResolvedConfig`, `TSubagentRunnerFactory`, etc.) is agent-framework's session construction/assembly _implementation_ layer, not a transport-facing _contract_; moving it would drag framework internals into the contract package or create a cycle. It stays in agent-framework; agent-transport keeps importing it from there (to be handled in L2/INFRA-012). Consistent with the spec's "exclude implementation types; move contract types" closure rule. Confirmed absent from `agent-interface-transport/src/`.
`packages/agent-transport/**` untouched (L1 scope respected).

### [GATE-COMPLETE] — ✅ PASS | 2026-06-14

**Status upgrade:** verifying → done
Prior-gate evidence chain intact: GATE-WRITE / GATE-APPROVAL / GATE-IMPLEMENT (all 2026-06-13) + GATE-VERIFY (2026-06-14) entries all present and PASS.
Completion Criteria checkboxes: TC-01, TC-02, TC-03 all `[x]` in `## Completion Criteria`.
Per-TC verification (commands + observed results, recorded at GATE-VERIFY): TC-01 — `agent-interface-transport/src/index.ts` exports the full transport-facing contract closure; type-import test `src/__tests__/contracts.test.ts` (expectTypeOf) → `pnpm --filter @robota-sdk/agent-interface-transport test` 5/5 passed. TC-02 — `agent-framework` re-exports verified (`command-api/effects.ts`, `command-api/types.ts`, `interactive/i-interactive-session.ts`, `interaction/IInteractionChannel.ts`); `pnpm typecheck` exit 0. TC-03 — `pnpm typecheck` exit 0 (all affected packages), `node scripts/harness/check-dependency-direction.mjs` "No dependency direction violations found" exit 0, `pnpm harness:conformance` `conformant: true` / `dependencyDirection: pass` exit 0, `--filter @robota-sdk/agent-framework test` 924/924.
Test Plan references: TC-01 → test file `packages/agent-interface-transport/src/__tests__/contracts.test.ts` (vitest expectTypeOf); TC-02 → build/typecheck assertion (commands above, no separate test file — re-export surface assertion); TC-03 → CI pipeline + dep-direction + conformance commands above. No TC-N silently unaddressed.
User-Execution done-gate: N/A — spec has no `## User Execution Test Scenarios` section (INFRA-010 Layer 1 is a type-relocation refactor with no user-facing flow); Test Plan evidence (build/typecheck/test/dep-direction/conformance, all green at GATE-VERIFY) is the governing evidence per `feedback_done_gate`.
Artifact action: `.agents/tasks/DATA-001.md` archived → `.agents/tasks/completed/DATA-001.md` (verified on disk); spec `## Tasks` link updated to the archived path with all-tasks-`[x]` note.
