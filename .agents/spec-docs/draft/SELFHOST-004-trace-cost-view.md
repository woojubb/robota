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
session-record history / `InteractionEvent` stream + usage snapshots the transports already consume. Per-operation
**timing** is the one datum not yet on any reachable path: it lives ONLY in `ExecutionAnalyticsPlugin`'s in-memory
`executionHistory` (`getExecutionData()`), which **no production package holds** — plugins load as opaque hook
bundles via `BundlePluginLoader` (nobody retains a typed `ExecutionAnalyticsPlugin` reference), and `agent-plugin`
is imported by NO package (`agent-system.md:79`). Worse, the GUI consumer (`apps/agent-app`) is a thin Electron
renderer talking to a `robota --serve` **sidecar process** over a loopback WS `TServerMessage` stream — any plugin
memory lives in the sidecar, unreachable from the renderer except over that transport contract. So the timeline
cannot be assembled "at the consumer." The correct source is the **`agent-core` operation seam** where per-operation
timing is genuinely measured — `function-tool.ts` already captures per-tool `executionTime` (`:71/:91`) and the
event-service already mints `span_…` ids (`event-service.ts`), with sibling per-op boundaries in
`execution-service.ts` / `conversation-service` / `execution-proxy.ts`. The framework's turn-level `extractTurnUsage`
is post-hoc and sees NO per-operation timestamps, so it is NOT the timing source (it only owns the turn-granular
`costUsd`). v1 emits a **per-operation span entry** (`op id/name + durationMs`, joinable to the turn) from those
`agent-core` seams onto the **record/history contract** (`agent-interface-transport`, as a first-class span entry on
`IInteractiveSessionRecord.history` — NOT a field on the turn-scoped `IUsageSnapshot`); a **new `TServerMessage`
carrier** then rides those span entries across the sidecar boundary. The `ExecutionAnalyticsPlugin` is a downstream
_recorder_ of that same timing, not the source anything must reach into. The per-source aggregation already exists
as `summarizeUsageBySource` (`agent-session-analytics/src/usage.ts`, ANALYTICS-001) and is EXTENDED to assemble the
timeline from the new record span entries — within its legal `agent-core` + `agent-interface-transport` deps.

## Architecture Review

### Affected Scope

- **Pricing SSOT stays `agent-core/src/context/model-pricing.ts`** (already the SSOT for per-model cost, already
  read by `LimitsPlugin` via `limits-helpers.ts` and by `/cost` via `agent-command/session/model-pricing.ts`). Do
  NOT declare a second cost authority.
- **`agent-interface-transport`** (the contract carrier): (a) add an **OPTIONAL, derived** `costUsd?: number` on
  `IUsageSnapshot` (`session-contracts.ts`) — a **turn-granular** amount, present iff `costStatus !== 'unknown'`
  (aligns with the existing enum); (b) add a **first-class per-operation span entry type** (`op id/name +
durationMs`, joinable to the turn) on **`IInteractiveSessionRecord.history`** — sub-turn granularity, so it is
  NOT hung on the turn-scoped `IUsageSnapshot`. Both optional = backward-compatible **at the contract level** (all
  construction sites keep compiling); populating them is **real work, not free** (below).
- **`agent-core`** (the per-operation timing SOURCE, no `agent-plugin` edge): per-operation timing is measured HERE,
  not in the framework — `function-tool.ts` already computes per-tool `executionTime` (`:71/:91`), the event-service
  mints `span_…` ids (`event-service.ts`), and `execution-service.ts` / `conversation-service` / `execution-proxy.ts`
  hold the sibling per-op boundaries. v1 emits a per-operation span entry (`op id/name + durationMs`) from those
  seams onto the record/history contract. This is where the genuine sub-turn timing lives; nothing reaches into a
  plugin.
- **`agent-framework`** (turn-granular `costUsd` + record assembly, no `agent-plugin` edge): the main-path snapshot
  builder `extractTurnUsage` (`interactive/interactive-session-execution.ts`, ~lines 201–232) currently hard-codes
  `costStatus: 'unknown'` and has **no model id in scope**, so `costUsd` would otherwise NEVER be present.
  `extractTurnUsage` MUST resolve the turn's model id and compute cost via `calculateModelCost` (the
  `agent-core/model-pricing.ts` SSOT — exact input/output split), flipping `costStatus` to `estimated`/`exact`.
  `extractTurnUsage` owns ONLY this turn-granular `costUsd` — it is post-hoc and sees no per-operation timestamps, so
  it does NOT stamp span timing (that is the `agent-core` seam above). The framework assembles the per-op span
  entries into the session record.
- **`agent-transport-protocol`** (the boundary carrier): **no existing `TServerMessage` variant carries per-operation
  timing or the assembled timeline** (`tool_start`/`tool_end` carry `IToolState` with no `durationMs`). Add a new
  `TServerMessage` variant carrying either the span entries or the assembled trace read-model, so it crosses the
  sidecar boundary to the GUI. Stated as real work, not "free."
- **`agent-session-analytics`** (pure read-model, now legally assembling the timeline): extend
  `summarizeUsageBySource` to produce **both** cost-by-source totals **and** the span timeline — the timeline is now
  assembled from the **per-operation span entries on `IInteractiveSessionRecord.history`**, so it stays entirely
  within this package's `agent-core` + `agent-interface-transport` deps (NO `agent-plugin` read, no illegal edge). It
  **cannot halt** a live run — no enforcement here. The assembled read-model reaches the GUI over the new
  `TServerMessage` carrier and the TUI in-process.
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

1. **Timing stamped onto the transport/record contract at the runtime seam; timeline assembled in the reducer;
   cap enforcement in `LimitsPlugin`; view mirrors SessionMonitor (CHOSEN).**
   - ✅ Timing enters a dependency-legal, reachable path: stamped in `agent-framework` (where the timestamps already
     exist) onto `agent-interface-transport`, so it rides `TServerMessage` across the sidecar boundary and the
     reducer assembles it within its own deps — NO `agent-plugin` edge anywhere; durable/replayable; works
     identically for TUI and the sidecar GUI. Enforcement stays in a runtime plugin (can actually halt).
   - ❌ Larger: touches the record/transport schema + the runtime write-path + the reducer. Real cost, sequenced
     (contract field → runtime stamp → reducer assembly → view) — accepted because it is the design that actually
     functions and stays rule-legal.
2. **Assemble the timeline "at the composition-root / consumer" from a held `ExecutionAnalyticsPlugin` instance.**
   - ✅ Would touch no contract.
   - ❌ **Non-viable — REJECTED.** No production package holds a typed `ExecutionAnalyticsPlugin` (plugins load as
     opaque hook bundles via `BundlePluginLoader`; `agent-plugin` is imported by NO package). Reading
     `getExecutionData()` would require an `agent-cli → agent-plugin` edge barred by `agent-system.md:79`; and for
     the GUI the consumer is a separate Electron renderer whose sidecar holds any plugin memory, unreachable except
     over the transport contract — which is exactly alternative (1). "Smaller" here means "inert."
3. **Put the budget cap (halt) in `agent-session-analytics`.**
   - ✅ Co-located with aggregation.
   - ❌ That package is a pure post-hoc reducer that **structurally cannot halt** a live run; also a second cost-cap
     SSOT beside `LimitsPlugin`. REJECTED (mis-layered + SSOT).
4. **A new standalone tracing pipeline package.**
   - ✅ Clean schema.
   - ❌ Duplicates usage/analytics + session-record history. REJECTED.

### Decision

Adopt (1): **per-operation span timing is measured at the `agent-core` operation seams** (`function-tool.ts`
per-tool `executionTime`, event-service `span_…` ids, `execution-service`/`conversation-service`/`execution-proxy`
boundaries) and emitted as a **first-class span entry** (`op id/name + durationMs`) onto
`IInteractiveSessionRecord.history` (`agent-interface-transport`) — NOT on the turn-scoped `IUsageSnapshot`, and NOT
via `extractTurnUsage` (which is post-hoc/turn-granular and sees no per-op timestamps). A **new `TServerMessage`
carrier** rides those span entries across the sidecar boundary; NO `agent-plugin` edge anywhere. The trace/cost
**read-model** extends `summarizeUsageBySource` to assemble **both** the span timeline (from the record span entries,
within its own deps) **and** cost-by-source. **Cap enforcement** in `LimitsPlugin` (per-run cumulative budget keyed
EXPLICITLY by `sessionId`, never time-resetting, accruing the exact per-turn `costUsd` threaded via a concrete
carrier field on `IPluginExecutionResult`); the **pricing SSOT stays `agent-core/model-pricing.ts`**, and the
turn-granular **`costUsd`** is owned on `IUsageSnapshot`, computed in `extractTurnUsage` via `calculateModelCost`;
the **view** mirrors `SessionMonitor` in TUI/GUI. The `ExecutionAnalyticsPlugin` is a downstream recorder of the same
timing, not the source. `dag-cost` is out of scope (DAG-subsystem metadata). Cost = financial risk, first-class.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-core (per-op span timing SOURCE — function-tool/event-service/execution seams), agent-interface-transport (`costUsd?` on IUsageSnapshot + per-op span entry on IInteractiveSessionRecord.history), agent-framework (turn-granular `costUsd` + record assembly; no agent-plugin edge), agent-transport-protocol (new `TServerMessage` carrier for span entries/trace), agent-session-analytics (read-model: timeline + cost-by-source, in-deps), agent-plugin `limits` (cap enforcement), transport-tui/-gui (view).
- [x] Sibling scan 완료 — reuses `summarizeUsageBySource` (ANALYTICS-001) + `LimitsPlugin` (existing `maxCost`) + `SessionMonitor` view + `function-tool.ts` per-tool `executionTime` + event-service `span_…` ids; NO new tracing pipeline; enforcement stays in a runtime plugin (analytics reducer cannot halt); NO `agent-plugin` edge into core/framework/reducer/cli; `dag-cost` excluded.
- [x] 대안 최소 2개 — 4 considered (timing-on-contract-from-core-seam + limits-enforcement CHOSEN; consumer-held-plugin REJECTED non-viable/no package holds the instance; cap-in-analytics REJECTED can't-halt/SSOT; new-pipeline REJECTED duplication), each Pro+Con.
- [x] 결정 근거 — per-op timing must be sourced where it is measured (agent-core operation seams) and enter a dependency-legal, reachable path (record span entry + new TServerMessage carrier), not trapped in plugin memory nor faked at the turn-granular framework seam; enforcement where it can halt (runtime plugin); aggregation in the pure reducer; cost SSOT owned once; GATE-APPROVAL re-review pending.

## Solution

Emit a per-operation span entry (`op id/name + durationMs`) from the `agent-core` operation seams (`function-tool.ts`
per-tool `executionTime`, event-service `span_…` ids, `execution-service`/`conversation-service`/`execution-proxy`)
onto `IInteractiveSessionRecord.history` (`agent-interface-transport`) — no `agent-plugin` edge; add a new
`TServerMessage` carrier so the span entries cross the sidecar boundary. Populate the turn-granular `costUsd` on
`IUsageSnapshot` in `extractTurnUsage` via `calculateModelCost` (this seam owns only `costUsd`, not span timing).
Extend `summarizeUsageBySource` to assemble **both** the span timeline (from the record span entries, within its own
deps) **and** cost-by-source. Add a per-run (`sessionId`) cumulative, never-time-resetting budget cap to
`LimitsPlugin` that accrues the exact per-turn `costUsd` (warn/halt). Render the trace/cost view in TUI + GUI
mirroring `SessionMonitor`, the timeline reaching the GUI over the new `TServerMessage` carrier.

## Affected Files

| File                                                                                                                                                                  | Change                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-interface-transport/src/session-contracts.ts`                                                                                                         | add OPTIONAL derived `costUsd?: number` on `IUsageSnapshot` (turn-granular, present iff `costStatus !== 'unknown'`) + a first-class per-operation span entry type (op id/name + `durationMs`) on `IInteractiveSessionRecord.history` (sub-turn — NOT on `IUsageSnapshot`)             |
| `packages/agent-core/src/{tool-registry/function-tool,services/execution-service,services/conversation-service,utils/execution-proxy,event-service/event-service}.ts` | per-operation timing SOURCE — emit `op id/name + durationMs` span entries from the existing operation seams (`function-tool` already measures `executionTime`; event-service already mints `span_…` ids) onto the record contract                                                     |
| `packages/agent-framework/src/interactive/interactive-session-execution.ts`                                                                                           | `extractTurnUsage` resolves the turn's model id + computes turn-granular `costUsd` via `calculateModelCost`, flips `costStatus` from `'unknown'`; assembles the per-op span entries into the session record (NO span-timestamp stamping here — post-hoc seam; NO `agent-plugin` edge) |
| `packages/agent-transport-protocol/src/ws-protocol.ts`                                                                                                                | add a new `TServerMessage` variant carrying the per-op span entries / assembled trace read-model across the sidecar boundary (no existing variant carries per-op `durationMs`)                                                                                                        |
| `packages/agent-session-analytics/src/usage.ts`                                                                                                                       | extend `summarizeUsageBySource` → assemble the span timeline (from the per-op span entries on `IInteractiveSessionRecord.history`) + cost-by-source totals; stays within `agent-core`+`agent-interface-transport` deps (NO `agent-plugin` read)                                       |
| `packages/agent-plugin/src/limits/` (`limits-plugin.ts`, `limits-helpers.ts`)                                                                                         | per-run cumulative budget keyed EXPLICITLY by `sessionId` (not `getKey()` precedence), never time-resets, accrues exact per-turn `costUsd` via a carrier field on `IPluginExecutionResult`; `resetLimits(sessionId)` at run start                                                     |
| `packages/agent-transport-tui/`, `packages/agent-transport-gui/`                                                                                                      | trace/cost view (mirror `SessionMonitor`)                                                                                                                                                                                                                                             |

## Completion Criteria

- [ ] TC-01: the extended `summarizeUsageBySource` produces per-source **cost** totals AND the span timeline (from the per-operation span entries on `IInteractiveSessionRecord.history`) — unit test on the reducer; it stays within its `agent-core` + `agent-interface-transport` deps (NO `agent-plugin` read).
- [ ] TC-02: a per-run cumulative budget cap in `LimitsPlugin`, keyed by `sessionId` and never time-resetting, warns/halts when exceeded and resets via `resetLimits(sessionId)` at run start — enforced by the runtime plugin, not the analytics reducer (unit + functional test).
- [ ] TC-03: no cap-enforcement is added to `agent-session-analytics` (it stays a pure read-model) — verified by grep/placement.
- [ ] TC-04: the cost SSOT is single **and single-PATH** — `costUsd` derives from `agent-core/model-pricing.ts` (`calculateModelCost`, exact input/output split) AND `LimitsPlugin` enforcement accrues that same exact per-turn `costUsd`, so the displayed and enforced figures share one computation path (the blended pre-execution estimate does NOT diverge from the exact figure); no second cost-cap authority beside `LimitsPlugin` (verified).
- [ ] TC-05: the TUI and GUI render the trace/cost view (behavior test + User Execution Scenario; headless CLI path per verification.md).
- [ ] TC-06: `extractTurnUsage` (`interactive-session-execution.ts`) resolves the turn's model id and populates `costUsd`, flipping `costStatus` from `'unknown'` to `estimated`/`exact` — unit test proving `costUsd` is actually present on the main-path snapshot (not perpetually absent).
- [ ] TC-07: per-operation timing is **measured at the `agent-core` operation seams and carried as span entries on `IInteractiveSessionRecord.history`** (sourced from the record contract, NOT from `ExecutionAnalyticsPlugin.getExecutionData()` and NOT stamped at the post-hoc `extractTurnUsage` seam); the timeline path adds **NO `agent-plugin` import to `agent-session-analytics`, `agent-framework`, OR `agent-cli`** (all remain plugin-import-free, per `agent-system.md:79`) — verified by the dependency-direction check across those packages.
- [ ] TC-08: a new `TServerMessage` variant carries the per-operation span entries / assembled trace across the sidecar boundary (contract test on `agent-transport-protocol`); the GUI renders it renderer-side — proving the timeline actually reaches `apps/agent-app` over the WS stream (not assumed "free").

## Test Plan

| TC    | Verification                                      | Type/Tool                    |
| ----- | ------------------------------------------------- | ---------------------------- |
| TC-01 | timeline + cost-by-source read-model (in-deps)    | vitest unit                  |
| TC-02 | cumulative cap halts (sessionId, never-reset)     | vitest unit + functional     |
| TC-03 | no enforcement in analytics                       | grep/placement               |
| TC-04 | single cost SSOT + single enforced/displayed path | placement review             |
| TC-05 | TUI/GUI view                                      | behavior test + headless CLI |
| TC-06 | `extractTurnUsage` populates `costUsd`            | vitest unit                  |
| TC-07 | span timing from core seam → record (no plugin x) | vitest unit + dep-direction  |
| TC-08 | new `TServerMessage` carrier reaches GUI          | contract test + behavior     |

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
- 2026-07-17 — **iteration 5: RE-REVIEW → REJECT, reworked.** The reviewer (correctly, code-verified) found the
  "consumer holds the plugin" premise FALSE: NO production package depends on `agent-plugin` or instantiates
  `ExecutionAnalyticsPlugin` (plugins load as opaque hook bundles via `BundlePluginLoader`); reading
  `getExecutionData()` would need an `agent-cli → agent-plugin` edge barred by `agent-system.md:79`; and the GUI
  consumer is a separate Electron renderer whose plugin memory lives in the `robota --serve` sidecar, reachable only
  over the `TServerMessage` WS contract. Three iterations had all relabeled the SAME illegal/unreachable timing join.
  **Adopted the reviewer's P2 as v1** (the design that actually works and stays rule-legal): per-operation `durationMs`
  is stamped onto the **transport/record contract** (`agent-interface-transport`) at the **runtime seam**
  (`agent-framework`, where the timestamps already exist and `extractTurnUsage` runs) — NO `agent-plugin` edge; the
  timeline rides `TServerMessage` across the sidecar boundary and `summarizeUsageBySource` assembles it within its
  own deps; the `ExecutionAnalyticsPlugin` becomes a downstream recorder, not the source. Rewrote Prior Art, Affected
  Scope, Alternatives (added consumer-held-plugin as REJECTED non-viable), Decision, checklist, Solution, Affected
  Files, TC-01 (timeline back in the reducer, in-deps), and **TC-07** (timing sourced from the contract; no
  `agent-plugin` edge to analytics/framework/cli — all three). Items 3 & 4 (sessionId keying, `costUsd` carrier)
  unchanged.
- 2026-07-17 — **iteration 6: RE-REVIEW → REVISE, applied.** The reviewer confirmed the P2 direction is now correct
  and rule-legal (dependency-legality sound, consumer-held-plugin correctly rejected) but caught a NEW false premise
  in the stamp SITE: `extractTurnUsage` is post-hoc/turn-granular and has **no per-operation timestamps in scope**
  (`executePromptTurn` captures no turn duration), so it cannot be the span-timing source. The genuine per-operation
  timing lives one layer down at the **`agent-core` operation seams** (`function-tool.ts` already measures per-tool
  `executionTime` `:71/:91`; event-service mints `span_…` ids; `execution-service`/`conversation-service`/
  `execution-proxy` boundaries). Fixes (a seam correction within the same chosen direction): (1) struck the false
  "timestamps already exist at `extractTurnUsage`" premise; (2) relocated the per-op timing SOURCE to the `agent-core`
  seams, emitting a span entry onto the record contract (added an `agent-core` Affected-Files row); `extractTurnUsage`
  now owns ONLY the turn-granular `costUsd`; (3) modelled the timing as a **first-class span entry on
  `IInteractiveSessionRecord.history`** (sub-turn), NOT a field on the turn-scoped `IUsageSnapshot`; (4) proved the
  transport path — no existing `TServerMessage` carries per-op timing, so added a new carrier variant
  (`agent-transport-protocol` row + TC-08), not claimed "free". Items P2/P3/P6 (sessionId keying, `costUsd` carrier,
  cost SSOT) kept as verified-correct. Iteration-7 re-review pending.
