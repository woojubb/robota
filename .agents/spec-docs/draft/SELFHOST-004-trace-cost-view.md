---
status: draft
type: OBSERVABILITY
tags: [tracing, cost, budget, agent-plugin, agent-interface-transport, tui, gui, selfhost]
---

# SELFHOST-004: run tracing + per-run cost budgeting view

## Problem

Promotes backlog [SELFHOST-004](../../backlog/SELFHOST-004-trace-cost-view.md) toward
[VISION.md](../../../VISION.md). Concrete symptom: when Robota develops Robota there is no in-UI view of a run's
LLM/tool span trace and no per-run/session **cumulative** cost with a cap — the `usage`/`execution-analytics`
plugins collect data and `LimitsPlugin` enforces a per-window cost cap, but nothing surfaces a **run trace + a
per-run cumulative budget** in the TUI/GUI.

## Prior Art Research

OpenAI Agents SDK built-in tracing dashboard (LLM/tool/handoff/guardrail spans,
https://openai.github.io/openai-agents-python/); Google ADK event/state step inspector Web UI
(https://google.github.io/adk-docs/); aider token-budgeted context (https://aider.chat/docs/); Cursor tool-call
budgets (https://cursor.com/docs). Common shape: a run **trace** + **token/cost accounting** in the UI with
optional budget caps. Robota constraint: cost is **already first-class** — `LimitsPlugin`
(`agent-plugin/src/limits`) enforces `maxCost`(USD)/`tokenCostPer1000` per window; the genuine delta is a
**per-run/session cumulative budget** (vs per-window) + a **trace view**. Span data comes from the session-record
history / `InteractionEvent` stream the transports already consume (NOT `execution-analytics`, which has only
generic operation timings + no cost). The per-source aggregation already exists as `summarizeUsageBySource`
(`agent-session-analytics/src/usage.ts`, ANALYTICS-001) and must be EXTENDED, not re-created.

## Architecture Review

### Affected Scope

- **Pricing SSOT stays `agent-core/src/context/model-pricing.ts`** (already the SSOT for per-model cost, already
  read by `LimitsPlugin` via `limits-helpers.ts` and by `/cost` via `agent-command/session/model-pricing.ts`). Do
  NOT declare a second cost authority.
- **`agent-interface-transport`**: add an **OPTIONAL, derived** `costUsd?: number` on `IUsageSnapshot`
  (`session-contracts.ts`) computed by agent-framework **via `model-pricing.ts`** at snapshot creation
  (`interactive-session-execution.ts`), present iff `costStatus !== 'unknown'` (aligns with the existing enum).
  Optional = backward-compatible (all construction sites keep compiling).
- **`agent-session-analytics`** (pure read-model): extend `summarizeUsageBySource` for **cost-by-source**. The
  **span timeline** is a distinct shape — `InteractionEvent` has order but no timings, so per-operation durations
  join from `execution-analytics` (timing) to cost from the usage snapshots. It **cannot halt** a live run — no
  enforcement here.
- **`agent-plugin` `limits`**: the halt/warn enforcement — add a **per-run cumulative budget as a NEW orthogonal
  axis** (accumulate across all turns of one run, never time-reset; define the run identifier vs session/executionId
  and where the run-start reset fires) — NOT merely a `maxCost` window-sibling. Reconcile with the existing
  **display-only monthly budget** (`.robota/budget.json`, `agent-command/session/session-command.ts`): per-run
  enforcement is orthogonal to the display-only monthly (do not add a third unreconciled budget notion).
- **`agent-transport-gui`** (`SessionMonitor`) / **`agent-transport-tui`** (its TUI analog `UsageSummaryEntry`/
  `SessionStatusBar`): the trace/cost **view**.

### Alternatives Considered

1. **Read-model in session-analytics (extend `summarizeUsageBySource`); cap enforcement in `LimitsPlugin`;
   cost SSOT decided in agent-interface-transport; view mirrors SessionMonitor (CHOSEN).**
   - ✅ Reuses the existing reducer + the existing cost-cap plugin + the existing monitor view; enforcement stays in
     a runtime plugin (can actually halt); correct layers.
   - ❌ Requires a deliberate `IUsageSnapshot` cost-field decision (a contract change), stated not hidden.
2. **Put the budget cap (halt) in `agent-session-analytics`.**
   - ✅ Co-located with aggregation.
   - ❌ That package is a pure post-hoc reducer that **structurally cannot halt** a live run; also a second cost-cap
     SSOT beside `LimitsPlugin`. REJECTED (mis-layered + SSOT).
3. **A new standalone tracing pipeline package.**
   - ✅ Clean schema.
   - ❌ Duplicates usage/analytics + session-record history. REJECTED.

### Decision

Adopt (1): trace/cost **read-model** by extending `summarizeUsageBySource` (sourcing spans from session-record
history / `InteractionEvent`); **cap enforcement** in `LimitsPlugin` (per-run cumulative budget beside its
per-window `maxCost`); the **cost SSOT** decided + owned in `agent-interface-transport` (add a cost-amount to
`IUsageSnapshot`, or source from `usage`-plugin storage — decided at design time); the **view** mirrors
`SessionMonitor` in TUI/GUI. `dag-cost` is out of scope (DAG-subsystem metadata). Cost = financial risk, first-class.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-interface-transport (cost SSOT), agent-session-analytics (read-model, extend `summarizeUsageBySource`), agent-plugin `limits` (cap enforcement), transport-tui/-gui (view).
- [x] Sibling scan 완료 — reuses `summarizeUsageBySource` (ANALYTICS-001) + `LimitsPlugin` (existing `maxCost`) + `SessionMonitor` view; NO new tracing pipeline; enforcement stays in a runtime plugin (analytics reducer cannot halt); `dag-cost` excluded.
- [x] 대안 최소 2개 — 3 considered (extend-reducer + limits-enforcement CHOSEN; cap-in-analytics REJECTED can't-halt/SSOT; new-pipeline REJECTED duplication), each Pro+Con.
- [x] 결정 근거 — enforcement must live where it can halt (runtime plugin), aggregation in the pure reducer, cost SSOT owned once; independent GATE-APPROVAL re-review pending.

## Solution

Extend `summarizeUsageBySource` into a per-run/session trace+cost read-model (spans from session-record history /
`InteractionEvent`); decide + own the cost amount in `agent-interface-transport`; add a per-run cumulative budget
cap to `LimitsPlugin` (warn/halt); render the trace/cost view in TUI + GUI mirroring `SessionMonitor`.

## Affected Files

| File                                                             | Change                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/agent-interface-transport/src/session-contracts.ts`    | cost SSOT decision (cost amount on `IUsageSnapshot`, or documented source) |
| `packages/agent-session-analytics/src/usage.ts`                  | extend `summarizeUsageBySource` → trace+cost read-model                    |
| `packages/agent-plugin/src/limits/`                              | per-run cumulative budget cap (beside per-window `maxCost`)                |
| `packages/agent-transport-tui/`, `packages/agent-transport-gui/` | trace/cost view (mirror `SessionMonitor`)                                  |

## Completion Criteria

- [ ] TC-01: the read-model produces a per-run trace (LLM/tool spans) + token+cost totals from the session record (unit test on the extended `summarizeUsageBySource`).
- [ ] TC-02: a per-run cumulative budget cap in `LimitsPlugin` warns/halts when exceeded — enforced by the runtime plugin, not the analytics reducer (unit + functional test).
- [ ] TC-03: no cap-enforcement is added to `agent-session-analytics` (it stays a pure read-model) — verified by grep/placement.
- [ ] TC-04: the cost SSOT is single (either the `IUsageSnapshot` cost field or the documented plugin source) — no second cost-cap authority beside `LimitsPlugin` (verified).
- [ ] TC-05: the TUI and GUI render the trace/cost view (behavior test + User Execution Scenario; headless CLI path per verification.md).

## Test Plan

| TC    | Verification                            | Type/Tool                    |
| ----- | --------------------------------------- | ---------------------------- |
| TC-01 | trace+cost read-model                   | vitest unit                  |
| TC-02 | cumulative budget cap halts (in limits) | vitest unit + functional     |
| TC-03 | no enforcement in analytics             | grep/placement               |
| TC-04 | single cost SSOT                        | placement review             |
| TC-05 | TUI/GUI view                            | behavior test + headless CLI |

## Tasks

`.agents/tasks/SELFHOST-004.md` — 미생성 (GATE-APPROVAL 통과 후 생성).

## Evidence Log

- 2026-07-16 — **GATE-APPROVAL iteration 1: REVISE** (independent proposal-reviewer). Flagged: cap enforcement
  mis-placed in a pure reducer (`agent-session-analytics` cannot halt); `LimitsPlugin` already does cost caps
  (missed sibling); cost SSOT/schema owner unnamed (`IUsageSnapshot` has costStatus, no amount); `execution-analytics`
  is not the span source; `dag-cost` spurious; missing the real alternative.
- 2026-07-16 — **Revisions applied (this draft):** enforcement moved to `LimitsPlugin` (per-run cumulative budget);
  read-model extends `summarizeUsageBySource`, spans from session-record/`InteractionEvent`; cost SSOT owned in
  `agent-interface-transport`; `dag-cost` dropped; real alternative (enforcement in limits vs analytics vs new
  plugin) added with decision; view mirrors `SessionMonitor`. Re-review pending.
- 2026-07-16 — **iteration 2: RE-REVIEW → REVISE, applied.** Re-reviewer: the pricing SSOT already exists
  (`agent-core/model-pricing.ts`, already read by LimitsPlugin + `/cost`) — do not declare a second. Fixed:
  `IUsageSnapshot` gains an OPTIONAL derived `costUsd?` computed via `model-pricing.ts` (backward-compatible);
  trace timeline (needs timing from execution-analytics) separated from cost-by-source (`summarizeUsageBySource`);
  per-run cumulative budget defined as a NEW orthogonal axis in LimitsPlugin (run id + reset); existing display-only
  monthly budget (`.robota/budget.json`) reconciled as orthogonal. Iteration-3 re-review pending.
