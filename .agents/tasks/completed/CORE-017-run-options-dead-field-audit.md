---
title: 'CORE-017: IRunOptions dead-field audit — toolChoice wired end-to-end; stream & orphan interfaces removed'
status: done
completed: 2026-07-04
created: 2026-07-04
priority: high
urgency: soon
area: packages/agent-core, packages/agent-provider
depends_on: []
---

# IRunOptions dead-field audit

Follow-on from the CORE-016 external bug report (`.design/bug-report-maxtokens-2026-07-03.md`
제안 3 — silent-ignore mitigation, generalized). A grep sweep found `IRunOptions.stream` and
`IRunOptions.toolChoice` advertised on the public interface yet never threaded — the same
defect class the report exposed: a typed, documented option the runtime silently ignores.

## Audit result (all 15 IRunOptions fields traced)

Threaded and consumed: `temperature`/`maxTokens` (CORE-016), `sessionId`/`userId`/`metadata`,
`signal`, `onTextDelta`/`onExecutionEvent`, `maxExecutionRounds`/`maxSameToolInputs`,
`allowToolOnlyCompletion`, `output`/`outputRetries` (CORE-015).

Dead surface found (sweep widened per the class rule): `IRunOptions.stream`/`toolChoice`,
`IAgentConfig.stream`/`toolChoice` (stray top-level), `IExtendedRunContext` (zero consumers),
`IGenerationConfig` (zero consumers).

## Approved design (user-confirmed 2026-07-04)

Scope size is not a constraint — the meaningful option is implemented properly, not removed:

1. **`TToolChoice` SSOT** (`interfaces/provider.ts`): `'auto' | 'none' | 'required' | { tool }`
   — replaces the string-swallowing `'auto' | 'none' | string`.
2. **Contract placement** (CORE-016 pattern): `defaultModel.toolChoice` default +
   `IRunOptions.toolChoice` run-scoped override (wins). Stray `IAgentConfig.stream`/`toolChoice`
   removed.
3. **Threading**: buildRunContext / runStream inline context → `IExecutionContext` →
   `buildFullExecutionContext` → both provider call sites → `IChatOptions.toolChoice`.
4. **Adapters (6 chat surfaces)**: OpenAI Chat Completions + compatible (Qwen/DeepSeek/Gemma)
   via shared `toOpenAICompatibleToolChoice`; OpenAI Responses (+ Qwen Responses) via
   `toOpenAIResponsesToolChoice`; Anthropic `toAnthropicToolChoice`
   (`required`→`{type:'any'}`); Gemini `toGeminiFunctionCallingConfig` (`required`→`ANY`,
   named→`ANY`+`allowedFunctionNames`). Bytedance is a video provider — out of scope.
5. **Loud failure**: `assertToolChoiceValid` at both chatOptions seams — named tool missing
   from the run's tool list, or `'required'`/named with zero tools, throws. No silent
   degradation.
6. **Removals**: `stream` (both interfaces — run/runStream are separate methods, the flag has
   no definable behavior), `IExtendedRunContext` + `IGenerationConfig` (orphans; type-SSOT
   duplicates of IRunOptions/model-config data).
7. **Recurrence guard**: `run-options-audit.test.ts` — a `Record<keyof Required<IRunOptions>,
consumer>` makes an unregistered (unthreaded) new field a COMPILE error.

## Test Plan

- Core threading: run/runStream × defaultModel-default/per-run-override (4 assertions) +
  3 loud-failure cases (`robota.test.ts` toolChoice describe block).
- `assertToolChoiceValid` unit matrix (`execution-service-helpers.test.ts`).
- Adapter mapping units: shared OpenAI mapper + Responses variant (`tool-choice.test.ts`),
  Anthropic (`message-converter.test.ts`), Gemini (`tool-schema-converter.test.ts`).
- keyof exhaustiveness audit test (`interfaces/__tests__/run-options-audit.test.ts`).
- Full core + provider suites, repo typecheck, harness scans green.

## User Execution Test Scenarios

- Agent-executability: **agent-executable** (scratch/src script, real Anthropic key from
  `packages/agent-cli/.env`).
- Prereq: `scratch/src/core-017-user-execution.ts` constructing a Robota with one zod function
  tool (e.g. `get_weather`) and a real provider.
- Steps: three live turns with an identical tool-inviting prompt —
  1. control `toolChoice: 'auto'` (or unset);
  2. `toolChoice: 'none'` — expect a prose answer with ZERO tool executions;
  3. `toolChoice: { tool: 'get_weather' }` — expect the tool to execute;
  4. `toolChoice: { tool: 'missing' }` — expect an immediate validation throw naming the miss.
- Expected: observable behavioral difference per directive; step 4 fails loudly before any
  provider call.
- Evidence: **PASS (live, 2026-07-04, real Anthropic claude-haiku-4-5).** Probe
  `scratch/src/core-017-user-execution.ts` output: [1 control/auto] toolExecutions=1 with a
  tool-informed answer; [2 none] toolExecutions=0 with a prose "no access to a weather tool"
  reply; [3 forced { tool: 'get_weather' }] toolExecutions=1 and a final answer consuming the
  result; [4 { tool: 'missing_tool' }] threw `toolChoice requests tool "missing_tool" which
is not available for this run` before any provider call — `CORE-017-OK`. The FIRST live run
  caught a real design gap no unit test saw: the forced directive re-applied on every round
  (10 tool executions, no final answer); fixed with first-round-only forcing
  (`resolveToolChoiceForRound`, execution-service-helpers.ts) + multi-round regression test
  (`robota.test.ts` "forced named tool applies to round 1 only") and re-verified live.
  Durable artifacts: `packages/agent-core/src/core/robota.test.ts` (toolChoice describe
  block, 8 tests), `packages/agent-core/src/services/execution-service-helpers.test.ts`
  (assertToolChoiceValid + resolveToolChoiceForRound), `packages/agent-core/src/interfaces/__tests__/run-options-audit.test.ts`
  (keyof exhaustiveness), `packages/agent-provider-openai-compatible/src/shared/openai-compatible/tool-choice.test.ts`,
  `packages/agent-provider-anthropic/src/anthropic/__tests__/message-converter.test.ts`,
  `packages/agent-provider-gemini/src/gemini/tool-schema-converter.test.ts`. Suites: core 825,
  provider 573, repo 63 test files groups green; typecheck 0 errors; lint 0 errors;
  44 harness scans; harness suite 223.
