---
status: approved
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

- **`agent-core` (hooks)**: a guardrail **`IHookTypeExecutor`** (`type: 'guardrail'`) — the guardrail set runs
  **inside the executor in parallel and fails fast**, mapping any failure onto the existing exit-code-2/`blocked`
  contract `runHooks` already understands. No new runner and no second block-decision mechanism; reuses
  `schema/structured-output.ts` for typed input/output validation.
- **`agent-session`**: **unchanged** — the executor rides the already-threaded `hookTypeExecutors` path
  (`session-run.ts` → `PermissionEnforcer` → `tool-hook-helpers.ts` `runPreToolHook` → `runHooks`), so fail-fast
  reuses the enforcement already in place with zero new session composition.
- **`agent-framework`**: the consumer **registration** surface — register the guardrail executor + its guardrail set.
- **`agent-core` (tool-registry)**: tool-**output** schema validation beside the existing tool-input
  `parameter-validator`, enforced in `function-tool.ts::execute` (same layer as tool-input validation).

### Alternatives Considered

1. **Guardrail as an in-process `IHookTypeExecutor` (`type: 'guardrail'`), reusing `runHooks`/`runPreToolHook`/`PermissionEnforcer` (CHOSEN).**
   - ✅ Composes with the EXISTING, proven enforcement path: `hookTypeExecutors` is already threaded end-to-end
     (`session-run.ts` → `PermissionEnforcer` → `runPreToolHook` → `runHooks`), so there is **zero new session
     wiring** and **one** turn-blocking mechanism. Parallel + fail-fast is preserved **inside** the executor
     (fan-out the guardrail set with `Promise.all`/`race`, first failure → exit code 2 / `blocked`). Typed
     input/output contract via `schema/structured-output.ts`. Lowest migration cost.
   - ❌ Guardrails become one sequential step _within_ `runHooks` ordering (parallelism lives inside the step, not
     across steps) — acceptable, since the requirement is that the guardrail _set_ runs in parallel, which the
     executor delivers.
2. **Give the in-process plugin-hook contract a return-based veto (make `beforeRun`/`beforeToolCall` block).**
   - ✅ Localizes to the hook engine.
   - ❌ **Correctness, not blast radius:** plugin hooks are a best-effort fan-out **notification** channel — many
     plugins, errors swallowed, run for observation. Giving them a return-veto conflates **observation with
     control**: a swallowed error or a silent plugin would then decide whether a turn proceeds. Wrong semantics for
     an enforcement decision. REJECTED.
3. **A separate parallel guardrail runner in `agent-core` + new `agent-session` composition (the prior draft's choice).**
   - ✅ A purpose-built parallel runner reads cleanly in isolation.
   - ❌ Introduces a **second, independently-ordered turn-blocking mechanism** alongside `runHooks`, plus new session
     composition to wire it in — a turn would then carry two block decisions with no defined ordering or precedence.
     The guardrail-as-executor (1) already gets parallelism inside the executor with none of that. REJECTED.
4. **A separate guardrail plugin package.**
   - ✅ Externalizable.
   - ❌ A plugin cannot fail-fast the turn today (plugin hooks are void/swallowed); wrong layer. REJECTED (the
     original spec's strawman).

### Decision

Adopt (1): guardrails are a registered in-process **`IHookTypeExecutor`** (`type: 'guardrail'`) in `agent-core`
that fans out to the registered guardrail set **in parallel and fails fast**, mapping any failure onto the existing
exit-code-2/`blocked` contract. Enforcement reuses the **single** path already in place (`runHooks` →
`runPreToolHook` → `PermissionEnforcer`) via the already-threaded `hookTypeExecutors` — **no new session wiring, no
second block-decision mechanism.** Consumer **registration in `agent-framework`** (register the executor + guardrail
set). Add tool-**output** schema validation in `agent-core` tool-registry, enforced in `function-tool.ts::execute`
beside the existing tool-input validation. Scope excludes model-output structured validation (CORE-015 already ships
it). Policies stay in the consumer.

### Validated Recommendation

- **Reachability:** the guardrail executor rides the already-threaded `hookTypeExecutors` path (`session-run.ts` →
  `PermissionEnforcer` → `runPreToolHook` → `runHooks`); a `blocked` result from the executor is the same denial
  `runPreToolHook`/`PermissionEnforcer` already return, so it is reachable and fails fast with **no** new
  composition. Verified against `hook-runner.ts` (`runHooks(..., executors?)`, `IRunHooksResult.blocked`) and the
  session enforcement path. A core-only _plugin_-hook placement is NOT reachable (plugin hooks void/swallowed).
- **Capability preservation:** CORE-015 model-output validation + tool-input validation are untouched and reused.
- **Adversarial:** risk = two independently-ordered turn-blocking mechanisms on one turn → prevented by reusing the
  single `runHooks` `blocked` path; parallelism lives INSIDE the executor, never as a second turn-level tier (TC-04
  asserts this).

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-core hooks (guardrail executor) + agent-core tool-registry (tool-output validator) + agent-framework (registration); agent-session unchanged (existing `hookTypeExecutors` threading). No package/app domain policy.
- [x] Sibling scan 완료 — reuses the EXISTING extensible hooks strategy (`IHookTypeExecutor`, `runHooks(..., executors?)`) and the already-threaded enforcement path; tool-output validation mirrors tool-input `parameter-validator` in the same layer (`function-tool.ts::execute`); enforcement stays on the single `runHooks`/`PermissionEnforcer` path, NOT core plugin hooks (void/swallowed).
- [x] 대안 최소 2개 — 4 considered (guardrail-as-executor CHOSEN; plugin-hook return-veto REJECTED on correctness; separate parallel runner + session composition REJECTED second-blocking-mechanism; plugin package REJECTED can't-fail-fast), each Pro+Con.
- [x] 결정 근거 — single enforcement path (guardrail executor → `blocked` → existing denial); parallelism inside the executor; tool-output validation in the same layer as tool-input; scope to the delta over CORE-015; independent GATE-APPROVAL re-review applied (iteration 2).

## Solution

Guardrails are a registered in-process `IHookTypeExecutor` (`type: 'guardrail'`) in agent-core: the executor fans
out to the registered guardrail set in parallel and fails fast, mapping any failure onto the existing
exit-code-2/`blocked` contract so enforcement reuses the single `runHooks` → `runPreToolHook` → `PermissionEnforcer`
path already threaded via `hookTypeExecutors` (no new session wiring, no second block mechanism). Registration API in
agent-framework registers the executor + guardrail set. Tool-output schema validation is enforced in agent-core
tool-registry (`function-tool.ts::execute`, beside the tool-input validator), throwing on mismatch before the result
returns. Reuse `schema/structured-output.ts` for typed input/output validation.

## Affected Files

| File                                                                                            | Change                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-core/src/hooks/executors/guardrail-executor.ts` (new) + `hooks/types.ts`        | guardrail `IHookTypeExecutor` (`type: 'guardrail'`): parallel fan-out + fail-fast → exit-code-2/`blocked` (no new runner)                                  |
| `packages/agent-core/src/tool-registry/output-validator.ts` (new) + `function-tool.ts::execute` | validate tool OUTPUT schema right after `result = await this.fn(...)`, throw on mismatch before return (same layer as tool-input `parameter-validator.ts`) |
| `packages/agent-framework/src/`                                                                 | register the guardrail executor + guardrail set (consumer registration)                                                                                    |
| `packages/agent-session/src/*`                                                                  | **unchanged** — existing `hookTypeExecutors` threading carries the executor end-to-end                                                                     |

## Completion Criteria

- [ ] TC-01: a failing guardrail **fails the turn fast** through the SAME `runHooks`→`runPreToolHook`→`PermissionEnforcer` `blocked`/denial path hooks already use (functional test in agent-session).
- [ ] TC-02: the guardrail executor runs its guardrail set in parallel; any failure fails fast → exit-code-2/`blocked` (unit test on the executor, agent-core).
- [ ] TC-03: tool-**output** schema validation rejects a malformed tool result **in agent-core tool-registry** (`function-tool.ts::execute`), surfaced as a thrown error the execution round already propagates — model-output validation (CORE-015) is unchanged and out of scope (unit test).
- [ ] TC-04: a guardrail block flows through the **single** existing `blocked`/denial return (no second, independently-ordered enforcement tier) — parallelism stays inside the executor (functional test in agent-session).
- [ ] TC-05: no domain guardrail policy in `packages/` (neutrality + interface-runtime guards pass).

## Test Plan

| TC    | Verification                                               | Type/Tool                |
| ----- | ---------------------------------------------------------- | ------------------------ |
| TC-01 | turn fail-fast via existing `blocked` path                 | vitest unit/functional   |
| TC-02 | executor: parallel fan-out + fail-fast                     | vitest unit (agent-core) |
| TC-03 | tool-output reject in `function-tool.ts::execute` (thrown) | vitest unit              |
| TC-04 | single enforcement path (no second tier)                   | functional test          |
| TC-05 | neutrality                                                 | interface-runtime scan   |

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
- 2026-07-17 — **GATE-APPROVAL iteration 2: RE-REVIEW → REVISE, applied.** Independent re-review punch-list applied:
  (1) added + resolved the key missing alternative — guardrail as an in-process `IHookTypeExecutor` (`type: 'guardrail'`)
  reusing `runHooks`/`runPreToolHook`/`PermissionEnforcer` via the already-threaded `hookTypeExecutors` (now CHOSEN);
  parallelism is preserved inside the executor, so there is no separate runner and no second turn-blocking mechanism,
  and no new session wiring; (2) corrected the tool-**output** validation layer — moved from agent-session
  `PermissionEnforcer` (a pre-tool permission gate) to agent-core tool-registry (`output-validator.ts` beside
  `parameter-validator.ts`, enforced in `function-tool.ts::execute` right after `result = await this.fn(...)`, throwing
  before return), by symmetry with tool-input validation; TC-03 names that site; (3) rewrote the plugin-hook
  return-veto rejection on a CORRECTNESS ground (best-effort notification/observation vs control), dropping the
  blast-radius framing; (4) TC-04 made concrete — a guardrail block flows through the single existing `blocked`/denial
  return, not a second tier. Affected Files / Completion Criteria / Test Plan updated accordingly.
- 2026-07-17 — **iteration 3: RE-REVIEW → ENDORSE** (independent proposal-reviewer). All 4 punch-list items verified
  against the code: `IHookTypeExecutor`/`runHooks(..., executors?)` + the `exitCode:2 → blocked` single contract +
  the end-to-end `hookTypeExecutors` threading all real (zero new session wiring); tool-output validator correctly
  placed in agent-core `function-tool.ts::execute` beside `parameter-validator.ts`; Alt-2 rejected on
  observation-vs-control; TC-04 asserts the single path. **GATE-APPROVAL PASSED.** Task-file guidance (non-blocking):
  register the guardrail executor under the `PreToolUse` event (the path that actually enforces `blocked`;
  `UserPromptSubmit` only injects stdout today), and inject the guardrail set into the executor by construction in
  agent-framework (the `{type:'guardrail'}` definition carries only matcher/config, not the set).
