---
status: draft
type: BEHAVIOR
tags: [model-routing, fallback, provider, agent-framework, selfhost]
---

# SELFHOST-006: per-role model routing + provider fallback (v1: subagent path)

## Problem

Promotes backlog [SELFHOST-006](../../backlog/SELFHOST-006-per-role-model-routing.md) toward
[VISION.md](../../../VISION.md). Concrete symptom: `/model` sets ONE global model, so a planning turn and an
editing turn both use it, and on a provider 5xx the turn hard-fails with no alternate. To develop Robota with
Robota cost-effectively and reliably, different roles (a strong planner vs a cheaper editor) should use fit models
and fall back on provider error.

## Prior Art Research

aider architect(planner)/editor two-model mode (https://aider.chat/docs/config/options.html); model-agnostic
provider swap in Google ADK / Mastra / Microsoft Agent Framework (https://google.github.io/adk-docs/ ,
https://learn.microsoft.com/en-us/agent-framework/overview/); Cursor Max mode budget selection
(https://cursor.com/docs). Common shape: model-agnostic provider swap; the sophisticated version is per-role model
selection + fallback. Robota constraint: rides the existing **provider DIP**; the role→model mapping must be keyed
by an **opaque `string` role id** — NOT a TS `enum` (the `interface-runtime` scan hard-fails on enum declarations)
and NOT a fixed `planner|editor|reviewer` union (that embeds an app-workflow opinion into a neutral library). This
**mirrors the existing analog**: subagent model resolution is keyed by an arbitrary agent name
(`create-subagent-session.ts` `resolveModelId(agentDefinition.model, …)`), an opaque key, not a fixed enum.

## Architecture Review

### Affected Scope

- **`agent-core`** (or a type-only interface package): the role→model mapping **contract** — `TRoleModelMap =
Record<string, TModelRef>` keyed by an **opaque string** role id (no enum, no fixed union). Type-only.
- **`agent-framework`**: a routing policy that resolves a model **per opaque role key** + falls back to an
  alternate provider/model on error, over the existing provider DIP.
- **`agent-provider-defaults`** (or `agent-cli`): the concrete role set (`planner`/`editor`/`reviewer` strings) —
  app-workflow opinion lives HERE, not in the neutral contract.
- **v1 reachability:** the interactive turn loop has **no role/phase signal today**, so v1 routes the **subagent
  path**, which already carries a per-agent `agentDefinition.model` (opaque-key resolution already exists there).
  A per-turn role signal for the main loop is P2 (below), not assumed by v1.

### Alternatives Considered

1. **Opaque-string role→model map (contract) + framework routing policy over the provider DIP + default set in
   agent-provider-defaults; v1 = subagent path (CHOSEN).**
   - ✅ Rides the existing DIP; mirrors the subagent opaque-key analog; neutral (no enum/fixed-union in libs);
     reachable in v1 (subagent path already carries a per-agent model).
   - ❌ The main-loop per-turn role signal does not exist yet → v1 is scoped to subagents; the main loop is P2.
2. **Fixed `planner|editor|reviewer` enum/union in the contract.**
   - ✅ Explicit.
   - ❌ `enum` breaks the `interface-runtime` scan; a fixed union embeds app-workflow into a neutral library.
     REJECTED.
3. **Bake routing into each provider package.**
   - ✅ Local to the provider.
   - ❌ Duplicates routing per provider + couples cross-provider fallback into one provider. REJECTED.

### Decision

Adopt (1): a `TRoleModelMap = Record<string, TModelRef>` contract keyed by an **opaque string** (type-only, in
agent-core / a type-only interface package); a framework routing policy over the provider DIP that resolves per
role key + falls back on provider error; the concrete `planner/editor/reviewer` set in `agent-provider-defaults`.
**v1 = the subagent path** (already opaque-keyed by agent name); the main-loop per-turn role signal is P2.
**Budget-based fallback is OUT of scope for v1** (needs cost accounting; ship per-role + error-fallback first).

### Validated Recommendation

- **Reachability:** v1's resolution point is the subagent path, which already resolves a per-agent model by an
  opaque name (`resolveModelId(agentDefinition.model, …)`) — reachable without a new turn-role signal. The main
  loop lacks that signal (verified: no `turnRole`/`phase` on the interactive session) → deferred to P2.
- **Capability preservation:** `/model` (global) is unchanged; this adds per-role resolution + error-fallback.
- **Adversarial:** risk = a fixed role enum/union leaking app-domain into a lib or breaking interface-runtime →
  designed out by the opaque-string key + concrete set in the default/product layer.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-core/interface (type-only opaque-key mapping), agent-framework (routing policy over DIP), agent-provider-defaults (concrete role set). v1 = subagent path.
- [x] Sibling scan 완료 — rides the existing provider DIP; mirrors the subagent opaque-key model resolution (`resolveModelId`); no per-provider coupling; concrete role set at the default/product layer (not the neutral contract).
- [x] 대안 최소 2개 — 3 considered (opaque-key+framework-policy CHOSEN; fixed-enum/union REJECTED interface-runtime+neutrality; per-provider REJECTED duplication), each Pro+Con.
- [x] 결정 근거 — opaque key (no enum) mirrors the subagent analog; v1 scoped to the reachable subagent path; budget deferred; independent GATE-APPROVAL re-review pending.

## Solution

`TRoleModelMap = Record<string, TModelRef>` (opaque string keys, type-only); a framework routing policy resolving
per role key + provider-error fallback over the DIP; the concrete `planner/editor/reviewer` set in
`agent-provider-defaults`. v1 resolves on the subagent path (opaque agent-name key already there). P2 adds a
per-turn role signal to the main loop; P3 adds budget-based fallback (cost accounting).

## Affected Files

| File                                                          | Change                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/agent-core/src/` (or a type-only interface package) | `TRoleModelMap = Record<string, TModelRef>` (opaque key)                |
| `packages/agent-framework/src/`                               | routing policy: resolve per role key + provider-error fallback over DIP |
| `packages/agent-provider-defaults/src/`                       | concrete `planner/editor/reviewer` role set                             |

## Completion Criteria

- [ ] TC-01: the routing policy resolves two distinct opaque role keys to two configured models (unit test); the contract is an opaque `Record<string, …>` — NO enum/fixed union (verified; interface-runtime passes if placed in an interface package).
- [ ] TC-02: on a provider error, the policy falls back to the configured alternate provider/model (unit + functional test).
- [ ] TC-03: v1 resolves on the subagent path (per-agent opaque key) — no new per-turn role signal is required for v1 (verified by the resolution site).
- [ ] TC-04: routing rides the existing provider DIP with no new provider→provider coupling (deps scan + placement).
- [ ] TC-05: no fixed role vocabulary (`planner`/`editor`/`reviewer`) in the neutral contract — the concrete set lives in `agent-provider-defaults`/`agent-cli` (verified).

## Test Plan

| TC    | Verification                    | Type/Tool                   |
| ----- | ------------------------------- | --------------------------- |
| TC-01 | per-role resolution, opaque key | vitest unit                 |
| TC-02 | fallback on provider error      | vitest unit + functional    |
| TC-03 | v1 subagent-path resolution     | unit at the resolution site |
| TC-04 | rides DIP, no coupling          | deps scan + placement       |
| TC-05 | no fixed role vocab in contract | grep/placement              |

## Tasks

`.agents/tasks/SELFHOST-006.md` — 미생성 (GATE-APPROVAL 통과 후 생성). P1 (this) = subagent-path per-role + error
fallback; P2 = main-loop per-turn role signal; P3 = budget-based fallback.

## Evidence Log

- 2026-07-16 — **GATE-APPROVAL iteration 1: REVISE** (independent proposal-reviewer). Placement ENDORSED; flagged:
  role key must be opaque string (enum banned by interface-runtime; fixed union = app-domain in a lib); contract
  owner unpinned; reachability gap (no per-turn role signal today); budget fallback bigger than error-fallback;
  thin Problem.
- 2026-07-16 — **Revisions applied (this draft):** `TRoleModelMap = Record<string, TModelRef>` opaque-key contract
  (no enum/union), mirroring the subagent `resolveModelId(agentDefinition.model)` analog; contract owner pinned
  (agent-core / type-only interface); v1 scoped to the reachable subagent path, main-loop role signal → P2; budget
  fallback → P3; concrete role set in agent-provider-defaults; concrete Problem symptom. Re-review pending.
