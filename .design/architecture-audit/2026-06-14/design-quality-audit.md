# Architecture Design-Quality Audit — 2026-06-14

A **design-quality** audit (distinct from the doc-vs-code conformance audit in this same folder). It judges
whether the architecture _itself_ is sound — layer boundaries, responsibility placement, coupling/cohesion,
SSOT, extension seams, and anti-patterns — by reading actual source, not docs. Three parallel auditors
(layer/dependency, responsibility/coupling, extension/anti-pattern), findings cross-verified against source.

## Verdict

**0 P0 (no hard violation), 8 P1 (real design weaknesses), 7 P2, 2 NIT.** The foundational invariants hold:
no dependency cycles, agent-core is genuinely zero-workspace-deps, the SDK is React-free, agent-cli's
composition root is clean, `any` discipline is near-perfect (0 `: any` / `as any` in src). The weaknesses are
concentrated in (a) **two SSOT/no-hardcoding rule violations baked into low layers**, (b) **feature logic placed
in shell/transport layers**, and (c) **duplicated domain tables/types** across packages.

## Strong points (what HOLDS)

- **Type-safety discipline is excellent** — 0 `: any` / `as any` / `<any>` in `packages/*/src`; 1 justified
  `@ts-expect-error` (3rd-party `marked-terminal`), 6 justified `eslint-disable` (TS overloads, PTY regex).
- **No dependency cycles / no back-edges.** agent-core has only `jssha`+`zod`; one-way graph holds. Cross-layer
  reaches that exist are type-only.
- **SDK React-free** — react/ink confined to agent-transport(TUI)/agent-web-ui/agent-playground.
- **agent-cli composition root** (`cli.ts`) is genuine wiring; agent-executor value-import only at the root.
- **agent-preset isolation** — exactly one workspace edge (agent-framework), no re-export.
- **Extension seams use registries/factories**, not hardcoded name dispatch (Command/Tool/Transport/Provider
  registries; all `switch` are exhaustive discriminated-union handling).
- **Typed error hierarchy exists** (`RobotaError` w/ category/recoverable/code); `InteractiveSession` is a
  well-decomposed coordinator, not a god object; agent-command reaches session only via `ICommandHostContext`.

## Findings

### P1 — real design weaknesses

| ID        | Title                                                                                                                                                       | Evidence                                                                                                                                                      | Rule touched                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **DQ-01** | `agent-interface-tui` ships **runtime logic** (`isPickerInteraction`/`isConfirmInteraction` type-guard fns) — interface packages must be types-only         | `packages/agent-interface-tui/src/command-interaction.ts:25-35`                                                                                               | Interface Package Rule (no runtime logic)     |
| **DQ-02** | **Vendor names hardcoded as core defaults** — `defaultModel ‖ 'gpt-4'`, `defaultProvider ‖ 'openai'` in the vendor-neutral foundation                       | `packages/agent-core/src/managers/agent-factory-helpers.ts:64-65`                                                                                             | No product names in code; vendor-neutral core |
| **DQ-03** | **Deprecated dead code** — `getAvailableModels()` warns + returns `[]`, still on `IManager` contract, no real callers                                       | `packages/agent-core/src/managers/ai-provider-manager.ts:199-212`                                                                                             | No deprecated code (delete/migrate)           |
| **DQ-04** | **Three parallel hardcoded model-pricing tables** (different shapes, drifting numbers) for the same fact                                                    | `agent-command/src/session/model-pricing.ts:7`; `agent-plugin/src/limits/limits-helpers.ts:20`; (correct) `agent-plugin/src/usage/usage-plugin-helpers.ts:41` | Type SSOT; no hardcoding                      |
| **DQ-05** | **`ISessionRecord` duplicated in agent-cli**, parsing the same on-disk files the store writes (+ duplicate `ISessionHistoryEntry` vs core `IHistoryEntry`)  | `agent-cli/src/session-analyzer/types.ts:13` vs `agent-session/src/session-store.ts:15`                                                                       | Type SSOT (extend, don't duplicate)           |
| **DQ-06** | **Session-analysis feature logic lives in agent-cli** (parser/reporter/analyzer, ~570 lines of timing classification + aggregation)                         | `agent-cli/src/session-analyzer/{parser,reporter,session-analyze-command}.ts`                                                                                 | agent-cli = thin shell, no feature logic      |
| **DQ-07** | **LLM session-naming feature embedded in agent-transport** — live `provider.chat()` + hardcoded prompt/limit in a protocol transport                        | `agent-transport/src/tui/session-naming.ts:5,8,19`                                                                                                            | Responsibility placement; no hardcoded policy |
| **DQ-08** | **agent-transport is a kitchen-sink** — root barrel `export *` fuses TUI(react/ink)+HTTP(hono)+WS+MCP; importing the root drags React/ink into any consumer | `agent-transport/src/index.ts:1-6` + `package.json` deps                                                                                                      | Cohesion / packaging                          |

### P2 — worth fixing

| ID        | Title                                                                                                                                           | Evidence                                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **DQ-09** | Token-estimation (`len/4`) re-hardcoded in 4 packages despite `agent-core/context/estimation.ts` owning it (one comment admits the dup)         | `agent-plugin/.../limits-helpers.ts:14`; `agent-session/src/session-run.ts:123`; `agent-command/src/context/context-command.ts:286,352` |
| **DQ-10** | `TContextState` is a parallel duplicate of core `IContextWindowState` (field renamed `usedPercentage`→`percentage`)                             | `agent-transport/src/tui/tui-state-manager.ts:23` vs `agent-core/src/context/types.ts:17`                                               |
| **DQ-11** | `agent-interface-transport` (a contract pkg) depends down into `agent-executor`+`agent-session` for types — contract layer binding to internals | `agent-interface-transport/package.json`; `session-contracts.ts:43-44`                                                                  |
| **DQ-12** | Ad-hoc pass-through re-exports ("for convenience") blur SSOT — e.g. `IContextWindowState`, `ISession`, `TRUST_TO_MODE` (a value)                | `agent-session/src/index.ts:26`, `session-interface.ts:2`; `agent-framework/src/types.ts:7-14`                                          |
| **DQ-13** | Raw `throw new Error()` dominates (426 vs 216 typed) on core-service + provider paths despite the typed hierarchy                               | `agent-core/src/services/execution-stream.ts:86,138`; `agent-provider/src/anthropic/provider.ts:76,307-316`                             |
| **DQ-14** | Fire-and-forget hooks swallow all errors via `.catch(() => {})` — zero observability on hook failure                                            | `agent-session/src/session-lifecycle.ts:71`; `session-run.ts:197,256`                                                                   |
| **DQ-15** | `getStats()` returns hardcoded-zero metrics with TODOs — abstraction lies rather than failing                                                   | `agent-plugin/src/error-handling/error-handling-plugin.ts:246-247`                                                                      |

### NIT

| ID        | Title                                                                                                        | Evidence                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| **DQ-16** | Silent default-model substitution `model ‖ 'gpt-4o-mini'` in OpenAI stream handler                           | `agent-provider/src/openai/streaming/stream-handler.ts:100` |
| **DQ-17** | `IAIProvider` exposes dual universal (`chat`) + raw (`generateResponse`) API surface — mild abstraction leak | `agent-core/src/interfaces/provider.ts:240-265`             |

## Recommended sequencing

Rule-violation fixes first (cheap, clearly correct), then SSOT consolidation, then layer relocations:

1. **DQ-02 + DQ-03** (rule violations, tiny) — remove vendor literals from core; delete deprecated method. ~1 PR.
2. **DQ-04 + DQ-09 + DQ-10** (SSOT consolidation) — one pricing owner, one estimator import, reuse
   `IContextWindowState`. Highest correctness value (drift today produces wrong cost/context %).
3. **DQ-01** — move tui type-guards out of the interface package (small, restores interface purity).
4. **DQ-05 + DQ-06** — pull `ISessionRecord` + session-analysis out of agent-cli into a library owner.
5. **DQ-07** — relocate session auto-naming to session/framework; transport invokes via contract.
6. **DQ-08** — stop root-barrel `export *` of TUI (or split transport) so React/ink are subpath-only.
7. P2/NIT (DQ-11~17) — error-typing pass, hook-failure observability, real metrics, dual-API SPEC decision.

All findings are **design changes** — each must go spec-before-code (backlog → spec → implement), not inline
edits. None is a release blocker. DQ-02/DQ-03 are direct rule violations and the cheapest to clear.
