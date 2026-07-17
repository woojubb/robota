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
**per-run/session cumulative budget** (vs per-window) + a **trace view**. Span attribution + cost come from the
session-record history / `InteractionEvent` stream + usage snapshots the transports already consume; per-operation
**timing** is the one thing that joins from `execution-analytics` (generic operation timings, no cost) — and that
join happens at the **composition-root / consumer** that registered the plugin (which already holds the concrete
`ExecutionAnalyticsPlugin` instance), NOT inside the pure reducer and NOT inside `agent-framework` (plugins are
consumer-opt-in; `agent-system.md:79` bars any `agent-plugin` import from `agent-framework`/`agent-cli` production
assembly paths). The per-source aggregation already exists as `summarizeUsageBySource`
(`agent-session-analytics/src/usage.ts`, ANALYTICS-001) and must be EXTENDED, not re-created.

## Architecture Review

### Affected Scope

- **Pricing SSOT stays `agent-core/src/context/model-pricing.ts`** (already the SSOT for per-model cost, already
  read by `LimitsPlugin` via `limits-helpers.ts` and by `/cost` via `agent-command/session/model-pricing.ts`). Do
  NOT declare a second cost authority.
- **`agent-interface-transport`**: add an **OPTIONAL, derived** `costUsd?: number` on `IUsageSnapshot`
  (`session-contracts.ts`), present iff `costStatus !== 'unknown'` (aligns with the existing enum). Optional =
  backward-compatible **at the contract level** (all construction sites keep compiling), but populating it is
  **real work, not free**: the main-path snapshot builder `extractTurnUsage`
  (`agent-framework/src/interactive/interactive-session-execution.ts`, ~lines 201–232) currently hard-codes
  `costStatus: 'unknown'` and has **no model id in scope**, so `costUsd` would otherwise NEVER be present.
  `extractTurnUsage` MUST resolve the turn's model id and compute cost via `calculateModelCost` (the
  `agent-core/model-pricing.ts` SSOT — exact input/output split) at snapshot creation, flipping `costStatus` to
  `estimated`/`exact` accordingly.
- **`agent-session-analytics`** (pure read-model): extend `summarizeUsageBySource` for **cost-by-source ONLY**
  (per-source cost totals derived from the usage snapshots it already reads). It does **not** build the span
  timeline: timing lives in `execution-analytics`'s in-plugin memory array (`executionHistory`, not the session
  record), and this package depends only on `agent-core` + `agent-interface-transport`, so reading `agent-plugin`
  timing here would violate the one-way dependency rule. It **cannot halt** a live run — no enforcement here.
- **Composition-root / consumer** (trace-timeline ASSEMBLY — CHOSEN): the span timeline is assembled at the
  consumer that registered the plugins (e.g. the `agent-cli` composition / the consumer-wired view layer), the ONLY
  layer that legally holds the concrete `ExecutionAnalyticsPlugin` instance and can read its per-operation `duration`
  (`getExecutionData()`), joining it to the snapshot `costUsd`. This **mirrors the established analog**: per
  `agent-system.md:79`, every plugin-derived datum reaches the view via consumer opt-in — `agent-plugin` is imported
  by NO package (`agent-cli`/`agent-framework` production source never import it; consumers pass plugin instances
  into the framework assembly API). Placing `assembleRunTrace(...)` in `agent-framework` was REJECTED: it would
  require a new, invariant-violating `agent-framework → agent-plugin` edge (verified: `agent-framework/package.json`
  has no such dep) — the same class of illegal edge as putting it in the reducer. Alternative — the timing PRODUCER
  writing per-operation `duration` into the session-record history as a typed entry, so `agent-session-analytics`
  could assemble the timeline within its `agent-core`+`agent-interface-transport` deps — is the most-correct
  long-term option (durable, replayable timing in the SSOT record) but larger (record-schema + analytics
  write-path); recorded as the P2 upgrade path. v1 assembles at the consumer, touching no contract and adding no
  illegal edge.
- **`agent-plugin` `limits`**: the halt/warn enforcement — add a **per-run cumulative budget as a NEW orthogonal
  axis** (accumulate across all turns of one run, never time-reset) — NOT merely a `maxCost` window-sibling. Pin
  the identifiers concretely: a **"run" = one interactive session, keyed EXPLICITLY by `sessionId`** — NOT via the
  generic `getKey()` precedence (`userId || sessionId || executionId`, `limits-plugin.ts:149`), which would mis-key
  a run that has a `userId`; the new cumulative axis reads `sessionId` directly. The cumulative accumulator **NEVER
  time-resets** (unlike the token-bucket / sliding-/fixed-window paths in `limits-helpers.ts`); the run-start reset
  fires via **`resetLimits(sessionId)`** at session/run start. **Unify enforced cost with displayed cost:** today
  enforcement computes cost via a BLENDED per-1000 rate over a single token count (`estimateBlendedCostPer1000`,
  `limits-helpers.ts`), while the displayed/derived `costUsd` uses the exact input/output split
  (`calculateModelCost`). For a "trace + budget" feature these MUST agree — the per-run cumulative accumulator MUST
  accrue the **exact per-turn `costUsd`** the view renders, threaded into `afterExecution` via a concrete carrier
  (a `costUsd` field on `IPluginExecutionResult` / the `afterExecution` context, so the plugin reads the exact
  snapshot figure rather than recomputing a blended estimate), NOT the blended pre-execution estimate; where an
  estimate is unavoidable (pre-execution admission check) it is reconciled to the exact figure after the turn, tied
  to `costStatus`. Reconcile with the
  existing **display-only monthly budget** (`.robota/budget.json`, `agent-command/session/session-command.ts`):
  per-run enforcement is orthogonal to the display-only monthly (do not add a third unreconciled budget notion).
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

Adopt (1): trace/cost **read-model** by extending `summarizeUsageBySource` for **cost-by-source only**, with the
**span-timeline assembly at the composition-root / consumer** (the layer that legally holds the concrete
`ExecutionAnalyticsPlugin` instance — NO `agent-plugin` edge is added to `agent-framework` or the reducer, per
`agent-system.md:79`); **cap enforcement** in `LimitsPlugin` (per-run cumulative budget keyed EXPLICITLY by
`sessionId`, never time-resetting, accruing the exact per-turn `costUsd` threaded via a concrete carrier field); the
**pricing SSOT stays `agent-core/model-pricing.ts`**, and the derived **`costUsd`** is owned on `IUsageSnapshot`
(`agent-interface-transport`), computed in `extractTurnUsage` via `calculateModelCost`; the **view** mirrors
`SessionMonitor` in TUI/GUI. `dag-cost` is out of scope (DAG-subsystem metadata). Cost = financial risk, first-class.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-interface-transport (cost SSOT), agent-session-analytics (read-model, extend `summarizeUsageBySource`, cost-only), agent-plugin `limits` (cap enforcement), composition-root/consumer (`assembleRunTrace`, holds the plugin instance — no agent-plugin edge into framework/reducer), transport-tui/-gui (view).
- [x] Sibling scan 완료 — reuses `summarizeUsageBySource` (ANALYTICS-001) + `LimitsPlugin` (existing `maxCost`) + `SessionMonitor` view; NO new tracing pipeline; enforcement stays in a runtime plugin (analytics reducer cannot halt); `dag-cost` excluded.
- [x] 대안 최소 2개 — 3 considered (extend-reducer + limits-enforcement CHOSEN; cap-in-analytics REJECTED can't-halt/SSOT; new-pipeline REJECTED duplication), each Pro+Con.
- [x] 결정 근거 — enforcement must live where it can halt (runtime plugin), aggregation in the pure reducer, cost SSOT owned once; independent GATE-APPROVAL re-review pending.

## Solution

Extend `summarizeUsageBySource` into a per-source **cost** read-model (cost only); assemble the span timeline at the
**composition-root / consumer** (`assembleRunTrace`, joining the registered `ExecutionAnalyticsPlugin`'s per-operation
timing to the snapshot `costUsd` — no `agent-plugin` edge into `agent-framework`/the reducer); populate the derived
`costUsd` on `IUsageSnapshot` in `extractTurnUsage` via `calculateModelCost`; add a per-run (`sessionId`) cumulative,
never-time-resetting budget cap to `LimitsPlugin` that accrues the exact per-turn `costUsd` (warn/halt); render the
trace/cost view in TUI + GUI mirroring `SessionMonitor`.

## Affected Files

| File                                                                                 | Change                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-interface-transport/src/session-contracts.ts`                        | add OPTIONAL derived `costUsd?: number` on `IUsageSnapshot` (present iff `costStatus !== 'unknown'`)                                                                                                                              |
| `packages/agent-framework/src/interactive/interactive-session-execution.ts`          | `extractTurnUsage` resolves the turn's model id + computes `costUsd` via `calculateModelCost`, flips `costStatus` from `'unknown'`                                                                                                |
| `apps/agent-app/` + `packages/agent-cli/` (composition-root, new `assembleRunTrace`) | trace-timeline ASSEMBLY at the consumer that registered the plugins — joins the `ExecutionAnalyticsPlugin` instance's per-operation `duration` to snapshot `costUsd`; NO `agent-plugin` edge into `agent-framework`/reducer       |
| `packages/agent-session-analytics/src/usage.ts`                                      | extend `summarizeUsageBySource` → cost-by-source ONLY (cost totals; no timeline, stays in-deps)                                                                                                                                   |
| `packages/agent-plugin/src/limits/` (`limits-plugin.ts`, `limits-helpers.ts`)        | per-run cumulative budget keyed EXPLICITLY by `sessionId` (not `getKey()` precedence), never time-resets, accrues exact per-turn `costUsd` via a carrier field on `IPluginExecutionResult`; `resetLimits(sessionId)` at run start |
| `packages/agent-transport-tui/`, `packages/agent-transport-gui/`                     | trace/cost view (mirror `SessionMonitor`)                                                                                                                                                                                         |

## Completion Criteria

- [ ] TC-01: the extended `summarizeUsageBySource` produces per-source **cost** totals (cost-by-source) from the usage snapshots — unit test on the reducer; it stays within its `agent-core` + `agent-interface-transport` deps and builds NO timeline.
- [ ] TC-02: a per-run cumulative budget cap in `LimitsPlugin`, keyed by `sessionId` and never time-resetting, warns/halts when exceeded and resets via `resetLimits(sessionId)` at run start — enforced by the runtime plugin, not the analytics reducer (unit + functional test).
- [ ] TC-03: no cap-enforcement is added to `agent-session-analytics` (it stays a pure read-model) — verified by grep/placement.
- [ ] TC-04: the cost SSOT is single **and single-PATH** — `costUsd` derives from `agent-core/model-pricing.ts` (`calculateModelCost`, exact input/output split) AND `LimitsPlugin` enforcement accrues that same exact per-turn `costUsd`, so the displayed and enforced figures share one computation path (the blended pre-execution estimate does NOT diverge from the exact figure); no second cost-cap authority beside `LimitsPlugin` (verified).
- [ ] TC-05: the TUI and GUI render the trace/cost view (behavior test + User Execution Scenario; headless CLI path per verification.md).
- [ ] TC-06: `extractTurnUsage` (`interactive-session-execution.ts`) resolves the turn's model id and populates `costUsd`, flipping `costStatus` from `'unknown'` to `estimated`/`exact` — unit test proving `costUsd` is actually present on the main-path snapshot (not perpetually absent).
- [ ] TC-07: the span timeline is assembled at the **composition-root / consumer** (`assembleRunTrace`), joining the registered `ExecutionAnalyticsPlugin`'s per-operation `duration` to snapshot `costUsd`, with **NO `agent-plugin` import added to EITHER `agent-session-analytics` OR `agent-framework`** (both remain plugin-import-free, per `agent-system.md:79`) — verified by the dependency-direction check across both packages, so the gate catches the relocated edge, not only the reducer.

## Test Plan

| TC    | Verification                                      | Type/Tool                    |
| ----- | ------------------------------------------------- | ---------------------------- |
| TC-01 | cost-by-source read-model (cost only, in-deps)    | vitest unit                  |
| TC-02 | cumulative cap halts (sessionId, never-reset)     | vitest unit + functional     |
| TC-03 | no enforcement in analytics                       | grep/placement               |
| TC-04 | single cost SSOT + single enforced/displayed path | placement review             |
| TC-05 | TUI/GUI view                                      | behavior test + headless CLI |
| TC-06 | `extractTurnUsage` populates `costUsd`            | vitest unit                  |
| TC-07 | timeline assembly at consumer (dep-legal, both)   | vitest unit + dep-direction  |

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
- 2026-07-17 — **iteration 3: RE-REVIEW → REVISE, applied.** Re-reviewer punch-list resolved (chosen alternative
  unchanged): (1) **timeline timing source** — the illegal cross-dep join is removed; `summarizeUsageBySource` is
  now **cost-by-source ONLY** (stays in its `agent-core`+`agent-interface-transport` deps), and the span timeline
  is assembled in **`agent-framework`** (alt. (b), new `assembleRunTrace`) which already depends on both the
  `ExecutionAnalyticsPlugin` timing (in-plugin `executionHistory`, not the record) and the snapshot `costUsd`.
  (2) **`costUsd` actually populates** — spec now states `extractTurnUsage` (`interactive-session-execution.ts`,
  hard-coded `costStatus: 'unknown'`, no model id in scope) MUST resolve the model id and compute cost via
  `calculateModelCost`, flipping `costStatus`; called out as real work, not free (added to Affected Files + TC-06).
  (3) **enforced == displayed cost** — the per-run accumulator accrues the exact per-turn `costUsd` (not the blended
  `estimateBlendedCostPer1000` estimate); estimate reconciled to exact after the turn, tied to `costStatus`.
  (4) **run id + reset pinned into the body** — "run" = one interactive session keyed by `sessionId`, accumulator
  never time-resets, run-start reset via `resetLimits(sessionId)`. (5) **TC-04 tightened** to assert a single
  computation PATH for enforced vs displayed cost, plus TC-07 for the dependency-legal timeline assembly. Affected
  Files, Completion Criteria, and Test Plan updated accordingly.
- 2026-07-17 — **iteration 4: RE-REVIEW → REVISE, applied.** Re-reviewer (correctly) caught that iteration-3 did
  NOT remove the illegal cross-layer edge — it MOVED it from `agent-session-analytics → agent-plugin` to
  `agent-framework → agent-plugin`, equally barred by `agent-system.md:79` (plugins are consumer-opt-in; no
  `agent-plugin` import in `agent-framework`/`agent-cli` production assembly; verified `agent-framework/package.json`
  has no such edge), and that TC-07 only guarded the reducer, leaving a gate blind spot. Fixes: **relocated the
  span-timeline assembly to the composition-root / consumer** (the layer that already holds the concrete
  `ExecutionAnalyticsPlugin` instance and reads its `duration` — the established consumer-opt-in analog), adding NO
  `agent-plugin` edge to framework or the reducer; the durable-timing-in-record option recorded as the P2 upgrade.
  **TC-07 now asserts BOTH `agent-session-analytics` AND `agent-framework` stay plugin-import-free** (dep-direction
  check across both). Item#4 keying pinned to read `sessionId` EXPLICITLY (not the `getKey()` `userId`-first
  precedence). Item#3 carrier named (a `costUsd` field on `IPluginExecutionResult`/`afterExecution` context).
  Iteration-5 re-review pending.
