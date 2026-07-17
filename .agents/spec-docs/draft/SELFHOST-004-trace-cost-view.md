---
status: draft
type: OBSERVABILITY
tags: [tracing, cost, budget, agent-plugin, tui, gui, selfhost]
---

# SELFHOST-004: first-class run tracing + token/cost budgeting view

## Problem

Promotes backlog [SELFHOST-004](../../backlog/SELFHOST-004-trace-cost-view.md) toward
[VISION.md](../../../VISION.md). Robota has `usage`/`execution-analytics` plugins + `dag-cost`, but **no
first-class trace + cost view** in the TUI/GUI. To develop Robota with Robota safely, the run's LLM/tool calls
and its token/cost spend must be visible and cappable.

## Prior Art Research

OpenAI Agents SDK built-in tracing dashboard (LLM/tool/handoff/guardrail spans,
https://openai.github.io/openai-agents-python/); Google ADK event/state step inspector Web UI
(https://google.github.io/adk-docs/); aider token-budgeted repo map (https://aider.chat/docs/repomap.html);
Cursor tool-call budgets / Max mode (https://cursor.com/docs). Common shape: a run **trace** + **token/cost
accounting** surfaced in the UI, with optional budget caps. Robota constraint: reuse the existing usage/analytics
plugins + `agent-session-analytics` + `dag-cost` as data sources; add aggregation + a view in the transports.
LLM cost caps are **financial risk, not DoS** — first-class, not filtered out.

## Architecture Review

### Affected Scope

- **`agent-plugin`**: extend `usage`/`execution-analytics` to emit a normalized trace + cost stream.
- **`agent-session-analytics`**: aggregate per-run/session token+cost.
- **`agent-transport-tui` / `agent-transport-gui`**: render the trace/cost view.

### Alternatives Considered

1. **Aggregate over existing plugins + surface a view in the transports (CHOSEN).**
   - ✅ Reuses usage/analytics/dag-cost; correct layers; no new data pipeline.
   - ❌ Needs a normalized trace/cost schema across the sources.
2. **A new standalone tracing package.**
   - ✅ Clean-slate schema.
   - ❌ Duplicates the existing usage/analytics plugins; more surface, no gain. REJECTED.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-plugin + agent-session-analytics (data), transport-tui/-gui (view). No new pipeline.
- [x] Sibling scan 완료 — reuses `usage`/`execution-analytics` plugins + `dag-cost`; no duplicate tracing package.
- [x] 대안 최소 2개 — 2 considered (reuse-plugins CHOSEN; new-package REJECTED duplication), each Pro+Con.
- [x] 결정 근거 — reuse-over-reinvention + correct layer; cost = financial risk (first-class); independent GATE-APPROVAL to run.

## Solution

Normalize a run trace (LLM/tool/handoff/guardrail spans) + token/cost accounting from the existing plugins +
`dag-cost`; aggregate in `agent-session-analytics`; render a trace/cost view in TUI + GUI, with an optional budget
cap that warns/halts.

## Affected Files

| File                                                             | Change                            |
| ---------------------------------------------------------------- | --------------------------------- |
| `packages/agent-plugin/src/{usage,execution-analytics}/`         | emit normalized trace+cost        |
| `packages/agent-session-analytics/src/`                          | per-run/session aggregation + cap |
| `packages/agent-transport-tui/`, `packages/agent-transport-gui/` | trace/cost view                   |

## Completion Criteria

- [ ] TC-01: a run emits a normalized trace (LLM/tool spans) + token+cost totals (unit test on aggregation).
- [ ] TC-02: a configured budget cap warns/halts when exceeded (unit + functional test).
- [ ] TC-03: the TUI and GUI render the trace/cost view (behavior test + User Execution Scenario).
- [ ] TC-04: no new standalone tracing pipeline — reuses existing plugins/dag-cost (verified by placement).

## Test Plan

| TC    | Verification            | Type/Tool                               |
| ----- | ----------------------- | --------------------------------------- |
| TC-01 | trace+cost aggregation  | vitest unit                             |
| TC-02 | budget cap              | vitest unit + functional                |
| TC-03 | TUI/GUI view            | behavior test + User Execution Scenario |
| TC-04 | reuse (no new pipeline) | placement review                        |

## Tasks

`.agents/tasks/SELFHOST-004.md` — 미생성 (GATE-APPROVAL 통과 후 생성).

## Evidence Log

- 2026-07-16 — **GATE-APPROVAL iteration 1: REVISE** (independent proposal-reviewer). Required before ENDORSE:
  (a) **move cap enforcement out of `agent-session-analytics`** — it is a pure post-hoc reducer that structurally
  cannot halt a live run; reuse/extend the existing `LimitsPlugin` (already enforces `maxCost`/`tokenCostPer1000`)
  for the halt/warn cap, or justify a distinct per-run cumulative-budget plugin as a `limits` sibling. (b) **name
  the cost SSOT/schema owner** — `IUsageSnapshot` (`agent-interface-transport`) has `costStatus` but no cost amount;
  decide add-cost-field-to-contract vs read-usage-plugin-storage, and where the normalized trace/cost schema is
  owned. (c) trace spans come from the session-record history / `InteractionEvent`, not `execution-analytics`
  (no span/cost model); **extend the existing `summarizeUsageBySource`**, don't describe it as new. (d) **drop
  `dag-cost`** (DAG-subsystem metadata, cross-boundary) or justify in one line. (e) add the real alternative
  (enforcement in limits vs new plugin vs analytics) with pro/con + decision; view should mirror `SessionMonitor`.
  **Revision pending.**
