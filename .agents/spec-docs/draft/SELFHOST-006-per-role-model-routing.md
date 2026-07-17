---
status: draft
type: BEHAVIOR
tags: [model-routing, fallback, provider, agent-framework, selfhost]
---

# SELFHOST-006: per-role model routing + provider fallback

## Problem

Promotes backlog [SELFHOST-006](../../backlog/SELFHOST-006-per-role-model-routing.md) toward
[VISION.md](../../../VISION.md). Robota has provider DIP + a `/model` command, but **no per-role routing**
(a strong planner model + a cheaper editor model) or **provider fallback** on failure. For Robota to develop
Robota cost-effectively and reliably, the planner/editor/reviewer phases should pick fit models and fall back on
error/budget.

## Prior Art Research

aider architect(planner)/editor two-model mode (https://aider.chat/docs/config/options.html); model-agnostic
provider swap in Google ADK / Mastra / Microsoft Agent Framework (https://google.github.io/adk-docs/ ,
https://learn.microsoft.com/en-us/agent-framework/overview/); Cursor Max mode budget selection
(https://cursor.com/docs). Common shape: model-agnostic provider swap; the sophisticated version is per-role
model selection + fallback. Robota constraint: rides the existing **provider DIP**; the routing policy is a
framework concern, the role→model mapping contract is a core/interface concern; no provider secrets/coupling in
the policy mechanism.

## Architecture Review

### Affected Scope

- **`agent-core` / `agent-interface-*`**: a role→model mapping **contract** (pure types).
- **`agent-framework`**: a routing policy that selects a model per role/phase + falls back on error/budget, over
  the existing provider DIP.
- **`agent-provider-defaults`**: the natural composition point for a default routing/fallback set.

### Alternatives Considered

1. **Routing policy in agent-framework over the provider DIP; mapping contract in core/interface (CHOSEN).**
   - ✅ Rides the existing DIP; correct layers; no new provider coupling; default set in agent-provider-defaults.
   - ❌ Needs a clean role taxonomy (planner/editor/reviewer) that stays neutral.
2. **Bake routing into each provider package.**
   - ✅ Local to the provider.
   - ❌ Duplicates routing per provider + couples cross-provider fallback into a single provider. REJECTED.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-core/interface (mapping contract), agent-framework (policy), agent-provider-defaults (default set).
- [x] Sibling scan 완료 — rides the existing provider DIP + `/model`; no new provider coupling; default set at the aggregator.
- [x] 대안 최소 2개 — 2 considered (framework-policy CHOSEN; per-provider REJECTED duplication/coupling), each Pro+Con.
- [x] 결정 근거 — routing is a cross-provider framework concern over the DIP; independent GATE-APPROVAL to run.

## Solution

A role→model mapping contract (core/interface) + a framework routing policy that resolves a model per role/phase
(planner/editor/reviewer) and falls back to an alternate provider/model on error or budget; a default routing/
fallback set composed in `agent-provider-defaults`.

## Affected Files

| File                                        | Change                                      |
| ------------------------------------------- | ------------------------------------------- |
| `packages/agent-interface-*` / `agent-core` | role→model mapping contract                 |
| `packages/agent-framework/src/`             | routing policy + fallback over provider DIP |
| `packages/agent-provider-defaults/src/`     | default routing/fallback set                |

## Completion Criteria

- [ ] TC-01: a planner turn and an editor turn resolve to the two configured models (unit test on the policy).
- [ ] TC-02: on a provider error, the policy falls back to the configured alternate (unit + functional test).
- [ ] TC-03: routing rides the existing provider DIP with no new provider coupling (verified by deps + placement).
- [ ] TC-04: no provider secrets/domain content in the policy mechanism (neutrality guard passes).

## Test Plan

| TC    | Verification           | Type/Tool                |
| ----- | ---------------------- | ------------------------ |
| TC-01 | per-role selection     | vitest unit              |
| TC-02 | fallback on error      | vitest unit + functional |
| TC-03 | rides DIP, no coupling | deps scan + placement    |
| TC-04 | neutrality             | interface-runtime scan   |

## Tasks

`.agents/tasks/SELFHOST-006.md` — 미생성 (GATE-APPROVAL 통과 후 생성).

## Evidence Log

- 2026-07-16 — **GATE-APPROVAL iteration 1: REVISE** (independent proposal-reviewer). Placement ENDORSED (framework
  policy over the provider DIP; default set in `agent-provider-defaults`), but required before sign-off:
  (a) **role key must be an opaque `string`** (`Record<string, ...>`/`TRoleModelMap`) — NOT a TS `enum` (the
  `interface-runtime` scan hard-fails on enum declarations) and NOT a fixed `planner|editor|reviewer` union (embeds
  app-domain into a neutral library); mirror the existing analog — subagent model resolution keyed by an arbitrary
  agent name (`create-subagent-session.ts` `resolveModelId(agentDefinition.model, …)`). Concrete role set lives in
  `agent-provider-defaults`/`agent-cli`. (b) **pin the contract to one owner** (agent-core types, or a type-only
  interface package). (c) **close the reachability gap** — the turn loop has no role/phase signal today; add the
  caller that tags a turn with its role, or scope v1 to the subagent path (already carries `agentDefinition.model`).
  (d) **split "budget" fallback out** (needs cost accounting) — ship per-role + error-fallback first. (e) concrete
  Problem symptom. **Revision pending.**
