---
status: draft
type: BEHAVIOR
tags: [guardrails, structured-output, validation, agent-core, selfhost]
---

# SELFHOST-005: structured output + parallel guardrails

## Problem

Promotes backlog [SELFHOST-005](../../backlog/SELFHOST-005-guardrails-structured-output.md) toward
[VISION.md](../../../VISION.md). Table-stakes reliability: validate agent input/output against typed contracts and
fail fast. For Robota to develop Robota safely, tool/model outputs must be validatable and bad output caught before
it acts.

## Prior Art Research

OpenAI Agents SDK — parallel guardrails, fail-fast, Pydantic-validated tool schemas
(https://openai.github.io/openai-agents-python/); CrewAI guardrails (https://docs.crewai.com/); Mastra eval
metrics gating (faithfulness/relevance/toxicity, https://mastra.ai/). Common shape: registerable input/output
guardrails that can run in parallel + fail fast, plus typed structured-output validation. Robota constraint: the
existing `agent-core` hooks/permissions engine is the natural host — a guardrail is a validating hook; specific
guardrail _policies_ are consumer/surface concerns (neutral mechanism in libs).

## Architecture Review

### Affected Scope

- **`agent-core`**: a guardrail **contract** + an engine hook that runs input/output guardrails (optionally in
  parallel) and can fail-fast; typed structured-output validation for tool/model results.

### Alternatives Considered

1. **Guardrail contract + engine hook in agent-core, over the existing hooks engine (CHOSEN).**
   - ✅ Reuses the hooks/permissions engine; correct layer; neutral; composes with existing hooks.
   - ❌ Needs a clean guardrail contract distinct from a plain hook (must express pass/fail + fail-fast).
2. **Guardrails as a separate plugin package.**
   - ✅ Optional/externalizable.
   - ❌ Input/output validation is core to the engine's turn; a plugin cannot fail-fast the turn as cleanly.
     REJECTED (belongs in core).

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-core (guardrail contract + engine hook). No package/app domain content.
- [x] Sibling scan 완료 — extends the existing hooks/permissions engine; no new tier; no duplicate validation path.
- [x] 대안 최소 2개 — 2 considered (core-hook CHOSEN; plugin REJECTED can't-fail-fast), each Pro+Con.
- [x] 결정 근거 — validation is core to the turn (fail-fast) + neutrality; independent GATE-APPROVAL to run.

## Solution

A guardrail contract (input/output, returns pass or fail-with-reason) run by an agent-core engine hook, optionally
in parallel, fail-fast on failure; typed structured-output validation for tool/model results. Policies are
registered by the consumer; the mechanism is neutral.

## Affected Files

| File                                                       | Change                             |
| ---------------------------------------------------------- | ---------------------------------- |
| `packages/agent-core/src/guardrails/` (new) + hooks wiring | guardrail contract + engine hook   |
| `packages/agent-core/src/schema/`                          | structured-output validation reuse |
| `packages/agent-core/docs/SPEC.md`                         | document the surface               |

## Completion Criteria

- [ ] TC-01: an output guardrail that fails blocks the turn (fail-fast) — unit test.
- [ ] TC-02: multiple guardrails run in parallel and any failure fails fast — unit test.
- [ ] TC-03: structured-output validation rejects a malformed tool/model result — unit test.
- [ ] TC-04: guardrails compose with existing hooks/permissions without a new tier (functional test).
- [ ] TC-05: no domain guardrail policy in `packages/` (neutrality guard passes).

## Test Plan

| TC    | Verification             | Type/Tool              |
| ----- | ------------------------ | ---------------------- |
| TC-01 | fail-fast blocks turn    | vitest unit            |
| TC-02 | parallel + fail-fast     | vitest unit            |
| TC-03 | structured-output reject | vitest unit            |
| TC-04 | composes with hooks      | functional test        |
| TC-05 | neutrality               | interface-runtime scan |

## Tasks

`.agents/tasks/SELFHOST-005.md` — 미생성 (GATE-APPROVAL 통과 후 생성).

## Evidence Log

- 2026-07-16 — **GATE-APPROVAL iteration 1: REVISE** (independent proposal-reviewer). Required before ENDORSE:
  (a) **three-layer placement mirroring the existing hooks/permissions split** — neutral contract + parallel/
  fail-fast runner in `agent-core`; the turn-blocking **enforcement in `agent-session`** (`session-run.ts` +
  `PermissionEnforcer` + `tool-hook-helpers.ts` — that is where fail-fast actually lives, NOT agent-core, whose
  plugin hooks are void/error-swallowed); consumer registration in `agent-framework`. Add agent-session + framework
  to Affected Files. (b) **scope to the delta over CORE-015** — `robotaRunStructured`/`schema/structured-output.ts`
  already ship structured-output validation + `StructuredOutputError` fail-fast; limit new work to the guardrail
  contract/runner + tool-OUTPUT schema validation (tool-input already validated). Reword TC-03 to the real gap.
  (c) replace the strawman alternative with the real ones (return-based veto on the in-process hook contract vs an
  in-process guardrail executor in the `runHooks` strategy engine) + an adversarial pass. **Revision pending.**
