---
status: done
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
by an **opaque `string` role id** — NOT a fixed `planner|editor|reviewer` union and NOT a TS `enum`. The
load-bearing reason is **neutrality**: a fixed union/enum embeds an app-workflow opinion into a neutral library.
(The `interface-runtime` enum scan is only a secondary guard — `scan-interface-runtime.mjs` globs
`packages/agent-interface-*/src`, so it does NOT mechanically cover `agent-core`; neutrality, not the scan, is
what forbids the enum here.) This **mirrors the existing analog**: subagent model resolution is keyed by an
**opaque model-alias string** — `agentDefinition.model` is a model alias (`sonnet`/`opus`/`haiku`, or a full model
id), NOT an agent name — resolved through a `Record<string, string>` model-shortcut map with pass-through
(`create-subagent-session.ts` `MODEL_SHORTCUTS[x] ?? x`): an opaque `string`→model `Record` with no enum, not a
fixed union.

## Architecture Review

### Affected Scope

- **`agent-core`**: the role→model mapping **contract** — `TRoleModelMap = Record<string, TModelRef[]>` keyed by
  an **opaque string** role id (no enum, no fixed union), whose value is an **ordered fallback chain** (first entry
  = primary; the rest = fallbacks in order). Each `TModelRef = { provider: string; model: string }` carries BOTH
  provider identity AND model — mirroring the global `defaultModel: { provider, model }` — so "fall back to an
  alternate provider" is expressible (a model id alone cannot express it). Type-only, placed beside the existing
  model/provider foundational contracts (`IProviderDefinition`, `IAIProvider`, `TModelEffort`, `defaultModel`) as
  SSOT; a new `agent-interface-provider` package for a single type-map is premature.
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
   - ❌ A fixed union embeds app-workflow opinion into a neutral library — the load-bearing objection. (`enum`
     would also trip the `interface-runtime` scan, but that scan only globs `agent-interface-*`, not `agent-core`,
     so neutrality — not the scan — is what rejects this.) REJECTED.
3. **Bake routing into each provider package.**
   - ✅ Local to the provider.
   - ❌ Duplicates routing per provider + couples cross-provider fallback into one provider. REJECTED.

### Decision

Adopt (1): a `TRoleModelMap = Record<string, TModelRef[]>` contract keyed by an **opaque string**, each value an
**ordered fallback chain** of `TModelRef = { provider, model }` (type-only, owned by **agent-core** beside its
model/provider foundational contracts as SSOT); a framework routing policy over the provider DIP that resolves per
role key + walks the chain to an alternate provider/model on provider error; the concrete `planner/editor/reviewer`
set in `agent-provider-defaults`.
**v1 = the subagent path** (the v1 role key = the subagent's agent identity — distinct from the model-alias key of
the `resolveModelId` resolution analog); the main-loop per-turn role signal is P2.
**Budget-based fallback is OUT of scope for v1** (needs cost accounting; ship per-role + error-fallback first).

### Validated Recommendation

- **Reachability:** v1's resolution point is the subagent path, which already resolves a per-agent model from an
  **opaque model-alias string** through a pass-through `Record` (`resolveModelId` → `MODEL_SHORTCUTS[x] ?? x`; the
  key is a model alias, not an agent name) — reachable without a new turn-role signal. The main loop lacks that
  signal (verified: no `turnRole`/`phase` on the interactive session) → deferred to P2.
- **Capability preservation:** `/model` (global) is unchanged; this adds per-role resolution + error-fallback.
- **Adversarial:** risk = a fixed role enum/union leaking app-domain into a lib or breaking interface-runtime →
  designed out by the opaque-string key + concrete set in the default/product layer.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-core (type-only opaque-key mapping, beside its model/provider contracts as SSOT), agent-framework (routing policy over DIP), agent-provider-defaults (concrete role set). v1 = subagent path.
- [x] Sibling scan 완료 — rides the existing provider DIP; mirrors the subagent opaque model-alias resolution (`resolveModelId` → `MODEL_SHORTCUTS[x] ?? x`); no per-provider coupling; concrete role set at the default/product layer (not the neutral contract).
- [x] 대안 최소 2개 — 3 considered (opaque-key+framework-policy CHOSEN; fixed-enum/union REJECTED on neutrality — interface-runtime scan only a secondary guard covering agent-interface-\*, not agent-core; per-provider REJECTED duplication), each Pro+Con.
- [x] 결정 근거 — opaque key (no enum) mirrors the subagent analog; v1 scoped to the reachable subagent path; budget deferred; GATE-APPROVAL PASSED (ENDORSE).

## Solution

`TRoleModelMap = Record<string, TModelRef[]>` (opaque string keys, each value an ordered fallback chain of
`TModelRef = { provider, model }`; type-only, owned by agent-core); a framework routing policy resolving per role
key + walking the fallback chain to an alternate provider/model on provider error over the DIP; the concrete
`planner/editor/reviewer` set in `agent-provider-defaults`. v1 resolves on the subagent path (opaque
model-alias key already there). P2 adds a per-turn role signal to the main loop; P3 adds budget-based fallback
(cost accounting).

## Affected Files

| File                                    | Change                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-core/src/`              | `TRoleModelMap = Record<string, TModelRef[]>` + `TModelRef = { provider, model }` (opaque key, ordered fallback chain) |
| `packages/agent-framework/src/`         | routing policy: resolve per role key + walk fallback chain to alternate provider/model over DIP                        |
| `packages/agent-provider-defaults/src/` | concrete `planner/editor/reviewer` role set                                                                            |

## Completion Criteria

- [x] TC-01: the routing policy resolves two distinct opaque role keys to two configured fallback chains, selecting each chain's primary `TModelRef` (unit test); the contract is an opaque `Record<string, TModelRef[]>` — NO enum/fixed union (verified by placement + review; neutrality, not the interface-runtime scan, is the binding constraint, since that scan does not cover agent-core).
- [x] TC-02: on a provider error, the policy walks to the next `TModelRef` in the role's ordered fallback chain — an alternate **provider and model** (each `TModelRef` carries both) — and succeeds (unit + functional test).
- [x] TC-03: v1 resolves on the subagent path (per-agent opaque key) — no new per-turn role signal is required for v1 (verified by the resolution site).
- [x] TC-04: routing rides the existing provider DIP with no new provider→provider coupling (deps scan + placement).
- [x] TC-05: no fixed role vocabulary (`planner`/`editor`/`reviewer`) in the neutral contract — the concrete set lives in `agent-provider-defaults`/`agent-cli` (verified).

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
- 2026-07-17 — **GATE-APPROVAL iteration 2: RE-REVIEW → REVISE, applied.** Independent re-review punch-list
  applied: (1) corrected the subagent analogy — the opaque key is a **model-alias string** resolved via
  `MODEL_SHORTCUTS[x] ?? x` pass-through, NOT an agent name (fixed in Prior Art Research + Validated
  Recommendation); (2) contract value changed from a single `TModelRef` to an **ordered fallback chain**
  `Record<string, TModelRef[]>`, with `TModelRef = { provider, model }` carrying provider identity AND model
  (mirrors the global `defaultModel`), so TC-02's alternate-provider fallback is expressible (contract, TC-01,
  TC-02, Affected Files, Solution reconciled); (3) contract owner pinned to **agent-core** (beside
  `IProviderDefinition`/`IAIProvider`/`TModelEffort`/`defaultModel` as SSOT; dropped the type-only-interface-package
  option), the no-enum/union constraint re-justified PRIMARILY on **neutrality** — the interface-runtime scan is
  only a secondary guard globbing `agent-interface-*`, not agent-core; (4) removed TC-01's stale interface-package
  parenthetical. Unchanged (all correct): v1 scoped to the subagent path, budget fallback → P3, rejection of
  enum/union + per-provider.
- 2026-07-17 — **iteration 3: RE-REVIEW → ENDORSE** (independent proposal-reviewer). All 4 punch-list items verified
  against the code: `resolveModelId` = `MODEL_SHORTCUTS[x] ?? x` over a model alias (not an agent name);
  `TRoleModelMap = Record<string, TModelRef[]>` with `TModelRef = { provider, model }` mirrors the global
  `defaultModel` and makes TC-02 fallback expressible; owner pinned to agent-core beside its provider/model peers,
  no-enum re-justified on neutrality (interface-runtime scan globs only `agent-interface-*`); TC-01 reconciled.
  Unchanged decisions (v1 subagent path, budget → P3, enum/per-provider rejections) all hold. **GATE-APPROVAL PASSED.**
  (Applied the non-blocking clarity nit: disambiguated the v1 role key = the subagent's agent identity, distinct from
  the model-alias key of the resolution analog.)
- 2026-07-18 — **GATE-IMPLEMENT + VERIFY + COMPLETE (v1).** `status` → `done`, TC-01…05 checked. Implemented
  per the ENDORSE'd decision: (agent-core) `TModelRef = { provider, model }` + `TRoleModelMap =
Record<string, TModelRef[]>` type-only contract (opaque keys, no enum/union); (agent-framework) neutral policy
  `resolveRoleModel` / `resolveRoleFallbackChain` / `runWithRoleFallback` (walks the chain via an injected `run()`
  over the DIP — no provider→provider edge); (agent-provider-defaults) `DEFAULT_ROLE_MODELS` concrete
  planner/editor/reviewer set; (subagent path) `create-subagent-session` resolves the model from the role map
  (opaque key = `role ?? name`; alias > role-map > parent). Tests: TC-01/02 policy (7), TC-03 subagent resolution
  (+3), TC-05 neutrality/well-formed (3). TC-04 by `check-dependency-direction` scan (54/54). Verify: agent-core +
  agent-framework 1154 + agent-provider-defaults 6 + typecheck + build + lint (0 errors) all green.
  **P2 (main-loop per-turn role signal) and P3 (budget-based fallback) remain as future follow-ups** — v1 is the
  reachable subagent path per the approved scope.
- 2026-07-18 — **PR #1214 review fixes (2 SHOULD + CONSIDER).** (1) contract shape renamed `TModelRef` →
  `interface IModelRef` per the code-quality rule (object shapes = interface); `TRoleModelMap =
Record<string, IModelRef[]>` unchanged. (2) subagent resolution now picks the chain entry whose
  `provider` matches the PARENT provider (`options.provider.name`) — v1 runs on the parent provider, so a
  foreign-provider primary is skipped (and a role with no parent-provider entry falls back to the parent
  model) rather than running a foreign model string on the parent provider. (3) `runWithRoleFallback`
  gained an optional `shouldRetry(err)` predicate (default retry-all) so a caller can narrow fallback to
  transient/provider errors. Tests added (cross-provider pick + parent fallback + non-retryable rethrow).
  **Dormancy disclosed:** no runner passes `roleModels` yet — the subagent resolution SITE + policy +
  default set are the v1 deliverable; wiring a runner to thread `roleModels` from config is a thin
  follow-up alongside P2.
