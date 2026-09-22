---
title: 'MCP-005: project MCP tool schemas safely across providers'
issue: https://github.com/woojubb/robota/issues/2528
status: done
created: 2026-09-03
completed: 2026-09-22
priority: high
urgency: soon
area: MCP schema projection
depends_on: [MCP-002, CORE-040]
---

# MCP-005: project MCP tool schemas safely across providers

## Objective

Preserve and deliver the independently verifiable outcome of [issue #2528](https://github.com/woojubb/robota/issues/2528) after its redundant child-Issue queue entry is absorbed into the RULE-023 Task graph.

## Source Constraints

- The source Issue remains the complete historical problem and acceptance record.
- Closing it as `NOT_PLANNED` means only that GitHub no longer schedules it independently; this Task remains `todo` until the product outcome is delivered.
- Preserve every security, data-correctness, dependency, and direct-replacement constraint from the source Issue; do not add compatibility shims unless a current runtime consumer proves necessity.

## Plan

Spec: `.agents/spec-docs/done/MCP-005-project-mcp-tool-schemas-safely-across-providers.md`

- [x] S1 · TC-01, TC-02, TC-03, TC-04, TC-12 — `agent-core`: `project-tool-schema.ts` (contract, constants, `projectToolSchema`, stable hash) built on `closeObjectSchemas`; shared fixture set under `schema/__tests__/fixtures/tool-schema-projection/`; seeded generator sweep
- [x] S1 · TC-05, TC-06 — `agent-core`: `AbstractAIProvider.projectionProfile()` / `projectTools()` with the instance memo and the single structured `logger.warn` quarantine line; default profile `undefined` adopts unchanged
- [x] S2 · TC-07, TC-08, TC-09, TC-10, TC-13 — providers: anthropic, openai (strict closure moves into the profile; converter drops its own `closeObjectSchemas`), openai-compatible (gemma/qwen/deepseek), gemini (field rebuild fed the projected schema, no silent drop); one conformance test per package over the shared fixtures
- [x] S2 · TC-11 — `agent-mcp`: execution-validation test only (`DiscoveredMCPTool` still validates against the CORE-040 original); no production change
- [x] TC-14, TC-15 — package tests, `pnpm build`, affected scans; SPEC layers for `agent-core` and the four provider packages name the contract, the profile and `tool_schema_quarantined`

## Test Plan

Exercise the source Issue's primary success path and at least one failure or refusal path, then run affected package tests, typecheck, build, and repository boundary scans. Record exact commands and outputs in the implementation lifecycle.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

**Executability probe:** `packages/agent-provider-openai/examples/verify-model-effort.ts` is the package's existing example runner (`pnpm exec tsx` resolves there, `tsconfig.examples.json` exists); the new script follows the same shape and is invoked the same way, so the command below is executable on a clean checkout with no network access.

### Scenario 1: one unprojectable MCP tool is quarantined with a diagnostic and the other tools still reach the provider

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=public-sdk-example
- Prerequisites: Node.js and pnpm are installed and `pnpm install` has completed; `@robota-sdk/agent-core` and `@robota-sdk/agent-provider-openai-compatible` are built; run from `packages/agent-provider-openai`; the example constructs the real `OpenAIProvider` with `strictTools: true` over a fake HTTP client that records the request and installs a capturing log sink, registers three tool schemas of which one carries a `__proto__` property name, and issues one `chat()`; no API key and no network are needed.
- Command: `pnpm exec tsx examples/verify-tool-schema-projection.ts`
- Observable type: sdk-result
- Observable rationale: source=public-sdk-return
- Expected observable: result=provider=openai; sent=2; quarantined=1; diagnostic=tool_schema_quarantined; repeated=0
- Cleanup: the example uses only in-process fakes and removes its log sink before exiting; it leaves no files, processes or connections.
- Evidence: recorded 2026-09-22 — `cd packages/agent-provider-openai && pnpm scenario:verify:tool-schema-projection` → exit 0, single printed line `result=provider=openai; sent=2; quarantined=1; diagnostic=tool_schema_quarantined; repeated=0`; durable runner `packages/agent-provider-openai/examples/verify-tool-schema-projection.ts`.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-22

**Status upgrade:** scenario drafted → scenario written

Ordering check: DONE-GATE-STAGE-1 has no prior gate (gate-catalogue.md § Prior-gate map) — exempt. Input state matches: `## User Execution Test Scenarios` carries `SCENARIO DRAFTED: automatable | 1` and exactly one `### Scenario N:` heading; `validateApplicableScenarioSection` (scripts/harness/user-execution-scenario-contract.mjs) returned `ok: true` with 1 scenario. Paired spec `.agents/spec-docs/done/MCP-005-project-mcp-tool-schemas-safely-across-providers.md` is `status: in-progress` with `[GATE-IMPLEMENT] — ✅ PASS | 2026-09-22` whose payload binds `plan: { outcome: automatable, count: 1 }` — the same verdict and count judged here. Judged by `backlog-gate-guard` against gate-catalogue.md § DONE-GATE-STAGE-1; tree premises against `origin/integration/agreement-014` @ `648521d83094235a8732ff38ebd41291d574c3f5` (HEAD equals it; `origin/develop` appears on the Judged-at line only for parser conformance).

- DONE-GATE-STAGE-1 — Every scenario is written with exact commands or UI steps, prerequisites, an expected observable result, and an evidence field: PASS — Scenario 1 carries `Command: pnpm exec tsx examples/verify-tool-schema-projection.ts` (one literal script path below `examples/`, no options, no chaining); `Prerequisites:` names the toolchain state (`pnpm install` done, `@robota-sdk/agent-core` and `@robota-sdk/agent-provider-openai-compatible` built), the working directory (`packages/agent-provider-openai`), the fixture the example constructs (real `OpenAIProvider` with `strictTools: true` over a fake HTTP client plus a capturing log sink, three tool schemas of which one carries a `__proto__` property name, one `chat()`), and that no API key or network is needed; `Expected observable: result=provider=openai; sent=2; quarantined=1; diagnostic=tool_schema_quarantined; repeated=0`; `Evidence:` is present and pending, naming what DONE-GATE-STAGE-2 must record (command, exit code, the printed `result=` line, durable runner path `packages/agent-provider-openai/examples/verify-tool-schema-projection.ts`). `Cleanup:` is present.
- DONE-GATE-STAGE-1 — Every scenario carries its executability decision: PASS — `Executability: agent-executable`; the decision holds on evidence checked here, not on the author’s word: `pnpm exec tsx --version` from `packages/agent-provider-openai` resolves `tsx v4.23.1` (root devDependency); `examples/verify-model-effort.ts` and `tsconfig.examples.json` exist in that package, so an `examples/*.ts` runner is an established shape there (API-001 Scenario 1 uses the identical `pnpm exec tsx examples/<script>.ts` form); `OpenAIProvider` accepts an injected `client?: OpenAI` (`src/openai/types.ts:174`) so the fake HTTP client is a real seam, and `strictTools` is a real option (`types.ts:160`); the spec’s § Affected Files names `examples/verify-tool-schema-projection.ts` (new) as this scenario’s runner. Observation, not a failure: the `Executability probe` paragraph describes `pnpm scenario:verify` as `pnpm exec tsx --conditions=source examples/verify-model-effort.ts`, but that package’s `scenario:verify` script is `pnpm typecheck` (package.json:52); the runner shape the probe relies on exists regardless, and the probe paragraph is not a scenario field.
- DONE-GATE-STAGE-1 — The scenario uses a canonical product-surface identity and matching invocation; its observable is not a build/typecheck/lint/test/harness/CI run or repository-text inspection: PASS — `Product surface: public-sdk-example` with `Surface rationale: shipped-interface=public-sdk-example`; invocation is a direct `pnpm exec tsx` of a literal path below `examples/` (canonical direct-example form); `Observable type: sdk-result` with `Observable rationale: source=public-sdk-return` and a `result=` shaped expected value. guardian-observable-verdict=product-behavior: the observable is what the shipped provider does on a user’s `chat()` call — how many tools it places in the outbound request (`sent=2`), that it quarantines the unprojectable one (`quarantined=1`) and emits the structured `tool_schema_quarantined` diagnostic once (`repeated=0` on the second identical turn, exercising the memo) — reported by the example from the public SDK return and the provider’s own log sink; no test runner, scan, or text inspection is the observable. The fake HTTP client is the in-repo fixture the preference-order rule asks for in place of a live service; the product code path (projection profile → `projectTools()` → request converter) runs for real up to the wire.
- DONE-GATE-STAGE-1 — A scenario requiring live credentials or an external service states that prerequisite explicitly: PASS as stated-not-required — the scenario requires neither: `Prerequisites:` says “no API key and no network are needed”, and `Cleanup:` confirms only in-process fakes are used; an executor learns from the scenario itself that it runs on a clean checkout.
- DONE-GATE-STAGE-1 — Exception path: N/A — no scenario is unwritten, so no exception reason is required or recorded.
- DONE-GATE-STAGE-1 — Field-completeness result: PASS — every required single-line label (Executability, Product surface, Surface rationale, Prerequisites, Command, Observable type, Observable rationale, Expected observable, Cleanup, Evidence) appears exactly once with a nonempty value; no `browser steps`, `UI steps`, barrier, or `product state path` field is present, as required for an `automatable` outcome on `public-sdk-example`/`sdk-result`.
- DONE-GATE-STAGE-1 — Scenario 1 record: name `Scenario 1: one unprojectable MCP tool is quarantined with a diagnostic and the other tools still reach the provider`; guardian-observable-verdict=product-behavior; surface `public-sdk-example`; surface rationale `shipped-interface=public-sdk-example`; invocation `pnpm exec tsx examples/verify-tool-schema-projection.ts`; observable type `sdk-result`; observable rationale `source=public-sdk-return`; expected observable `result=provider=openai; sent=2; quarantined=1; diagnostic=tool_schema_quarantined; repeated=0`.

Observation outside this gate’s criteria, for the orchestrator: `node scripts/harness/scan-spec-user-execution-section.mjs` currently reports `✗ active/MCP-005-project-mcp-tool-schemas-safely-across-providers.md: post-cutover user-execution contract failed: missing ## User Execution Test Scenarios section.` — the paired spec carries no such section. That is a spec-side floor (backlog-execution.md § User Execution Test Scenario Rule), not a DONE-GATE-STAGE-1 criterion on this Task, and it does not alter this verdict.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: one unprojectable MCP tool is quarantined with a diagnostic and the other tools still reach the provider",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "pnpm exec tsx examples/verify-tool-schema-projection.ts",
      "observableType": "sdk-result",
      "observable": "result=provider=openai; sent=2; quarantined=1; diagnostic=tool_schema_quarantined; repeated=0",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Node.js and pnpm are installed and `pnpm install` has completed; `@robota-sdk/agent-core` and `@robota-sdk/agent-provider-openai-compatible` are built; run from `packages/agent-provider-openai`; the example constructs the real `OpenAIProvider` with `strictTools: true` over a fake HTTP client that records the request and installs a capturing log sink, registers three tool schemas of which one carries a `__proto__` property name, and issues one `chat()`; no API key and no network are needed.",
      "action": {
        "kind": "command",
        "value": "pnpm exec tsx examples/verify-tool-schema-projection.ts"
      },
      "expectedObservable": "result=provider=openai; sent=2; quarantined=1; diagnostic=tool_schema_quarantined; repeated=0",
      "cleanup": "the example uses only in-process fakes and removes its log sink before exiting; it leaves no files, processes or connections.",
      "evidence": "pending implementation — recorded at DONE-GATE-STAGE-2 with the command, its exit code and the single printed `result=` line, plus the durable runner path `packages/agent-provider-openai/examples/verify-tool-schema-projection.ts`."
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

**Judged by:** `backlog-gate-guard` (semantic set; mechanical floor re-run by the guardian via `validateApplicableScenarioSection`)
**Judged at:** HEAD `648521d83094` · base `origin/develop@3c7b5e60e78b` · document `.agents/tasks/MCP-005-project-mcp-tool-schemas-safely-across-providers.md` blob `5f51ce559280` (modified)
