---
status: draft
type: BEHAVIOR
tags:
  [guardrails, structured-output, validation, agent-core, agent-session, agent-framework, selfhost]
---

# SELFHOST-005: parallel guardrails (+ tool-output validation)

## Problem

Promotes backlog [SELFHOST-005](../../backlog/SELFHOST-005-guardrails-structured-output.md) toward
[VISION.md](../../../VISION.md). Concrete symptom: an agent turn can produce a bad tool/model output and act on it
— there is no registerable input/output **guardrail** that runs (in parallel) and **fails the turn fast**. Note
structured _model_-output validation already ships (CORE-015: `robotaRunStructured` + `schema/structured-output.ts`

- `StructuredOutputError` fail-fast), and tool-_input_ validation ships (`parameter-validator.ts`). The genuine
  gap is (a) a general guardrail contract + parallel/fail-fast runner and (b) tool-**output** schema validation.

## Prior Art Research

OpenAI Agents SDK — parallel guardrails, fail-fast, Pydantic-validated schemas
(https://openai.github.io/openai-agents-python/); CrewAI guardrails (https://docs.crewai.com/); Mastra eval-metric
gating (https://mastra.ai/). Common shape: registerable input/output guardrails that run in parallel + fail fast.
Robota constraint: this mirrors the **existing hooks/permissions split**, which is deliberately three-layer — pure
mechanism/contract in `agent-core` (`runHooks`, `evaluatePermission`, `schema/structured-output.ts`), the
**turn-blocking fail-fast enforcement in `agent-session`** (`session-run.ts` fires `UserPromptSubmit`/`Stop`,
`PermissionEnforcer`, `tool-hook-helpers.ts` `runPreToolHook` returns the tool-blocking denial), and consumer
registration in `agent-framework`. agent-core's own plugin hooks are void-returning + error-swallowed, so a
guardrail cannot fail-fast from there — enforcement must be in the turn owner (agent-session).

## Architecture Review

### Affected Scope

- **`agent-core`**: the neutral guardrail **contract** + a **parallel/fail-fast runner** (mechanism only), reusing
  `schema/structured-output.ts` for typed validation.
- **`agent-session`**: the **enforcement point** — compose the guardrail run into the turn (`session-run.ts` /
  `PermissionEnforcer` / `tool-hook-helpers.ts`) so a failing guardrail fails the turn fast (this is where fail-fast
  actually lives).
- **`agent-framework`**: the consumer **registration** surface for guardrails.
- Tool-output schema validation added alongside the existing tool-input `parameter-validator`.

### Alternatives Considered

1. **Three-layer: contract+runner in agent-core, fail-fast enforcement in agent-session, registration in framework
   (CHOSEN).**
   - ✅ Mirrors the proven hooks/permissions split; enforcement where fail-fast actually happens (agent-session);
     reuses CORE-015 structured-output + tool-input validator; neutral.
   - ❌ Correct radius is three packages + their SPECs (not one).
2. **Give the in-process plugin-hook contract a return-based veto (make `beforeRun`/`beforeToolCall` block).**
   - ✅ Localizes to the hook engine.
   - ❌ Changes the semantics of every existing plugin hook (currently void/error-swallowed) — a wide, risky change
     to a shipped contract. REJECTED for v1 (kept as a considered option).
3. **A separate guardrail plugin package.**
   - ✅ Externalizable.
   - ❌ A plugin cannot fail-fast the turn today (plugin hooks are void/swallowed); wrong layer. REJECTED (the
     original spec's strawman).

### Decision

Adopt (1): neutral guardrail **contract + parallel/fail-fast runner in `agent-core`**; **turn-blocking enforcement
in `agent-session`** (composed with `PermissionEnforcer`/the `UserPromptSubmit`/`Stop` path); consumer
**registration in `agent-framework`**; add tool-**output** schema validation beside the existing input validator.
Scope excludes model-output structured validation (CORE-015 already ships it). Policies stay in the consumer.

### Validated Recommendation

- **Reachability:** the turn that must fail-fast is owned by `agent-session` (`session-run.ts`), where
  `runPreToolHook`/`PermissionEnforcer` already block — so a guardrail run composed there is reachable and can
  fail-fast; a core-only placement is NOT (plugin hooks void/swallowed). Verified.
- **Capability preservation:** CORE-015 model-output validation + tool-input validation are untouched and reused.
- **Adversarial:** risk = a guardrail placed only in core silently not blocking → prevented by putting enforcement
  in agent-session (TC-01/04 assert turn-blocking there).

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-core (contract+runner), agent-session (fail-fast enforcement), agent-framework (registration). No package/app domain policy.
- [x] Sibling scan 완료 — mirrors the hooks/permissions three-layer split; reuses CORE-015 `schema/structured-output.ts` + tool-input `parameter-validator`; enforcement in the turn owner (agent-session), NOT core plugin hooks (void/swallowed).
- [x] 대안 최소 2개 — 3 considered (three-layer CHOSEN; hook-return-veto REJECTED wide-contract-change; plugin REJECTED can't-fail-fast), each Pro+Con.
- [x] 결정 근거 — fail-fast lives in agent-session; contract/mechanism in core; scope to the delta over CORE-015; independent GATE-APPROVAL re-review pending.

## Solution

Neutral guardrail contract (input/output → pass | fail-with-reason) + a parallel/fail-fast runner in agent-core;
enforcement composed into the turn in agent-session (fails the turn on a failing guardrail); registration API in
agent-framework; tool-output schema validation beside the input validator. Reuse `schema/structured-output.ts`.

## Affected Files

| File                                                                                | Change                                         |
| ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| `packages/agent-core/src/guardrails/` (new) + `schema/` reuse                       | guardrail contract + parallel/fail-fast runner |
| `packages/agent-session/src/{session-run,permission-enforcer,tool-hook-helpers}.ts` | compose guardrail run → fail-fast the turn     |
| `packages/agent-framework/src/`                                                     | guardrail registration surface                 |
| tool-output validator (beside `parameter-validator.ts`)                             | validate tool OUTPUT schemas                   |

## Completion Criteria

- [ ] TC-01: a failing output guardrail **fails the turn fast** at the agent-session enforcement point (unit/functional test in agent-session).
- [ ] TC-02: multiple guardrails run in parallel; any failure fails fast (unit test on the core runner).
- [ ] TC-03: tool-**output** schema validation rejects a malformed tool result (unit test) — model-output validation (CORE-015) is unchanged and out of scope.
- [ ] TC-04: guardrail enforcement composes with the existing `PermissionEnforcer`/hook path without a second enforcement tier (functional test in agent-session).
- [ ] TC-05: no domain guardrail policy in `packages/` (neutrality + interface-runtime guards pass).

## Test Plan

| TC    | Verification                     | Type/Tool                |
| ----- | -------------------------------- | ------------------------ |
| TC-01 | turn fail-fast in agent-session  | vitest unit/functional   |
| TC-02 | parallel + fail-fast runner      | vitest unit (agent-core) |
| TC-03 | tool-output reject               | vitest unit              |
| TC-04 | composes with PermissionEnforcer | functional test          |
| TC-05 | neutrality                       | interface-runtime scan   |

## Tasks

`.agents/tasks/SELFHOST-005.md` — 미생성 (GATE-APPROVAL 통과 후 생성).

## Evidence Log

- 2026-07-16 — **GATE-APPROVAL iteration 1: REVISE** (independent proposal-reviewer). Flagged: fail-fast engine is
  in `agent-session` not agent-core (core plugin hooks void/swallowed); CORE-015 already ships structured output
  (over-scoped); strawman alternative; Affected Files omitted agent-session/framework.
- 2026-07-16 — **Revisions applied (this draft):** three-layer placement (contract+runner in agent-core,
  enforcement in agent-session, registration in agent-framework); scoped to the delta over CORE-015 (guardrail
  contract/runner + tool-OUTPUT validation; TC-03 reworded); real alternatives (hook return-veto vs guardrail
  executor) with adversarial notes; agent-session + framework added to Affected Files. Re-review pending.
