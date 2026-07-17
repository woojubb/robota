<!-- archival-exempt: EPIC in progress — a large 7-package observability epic split into named work units; P1 (turn-granular cost foundation, TC-06) is the first slice. P2..P5 remain, so the spec stays in spec-docs/active/ until the slices land and GATE-VERIFY/GATE-COMPLETE run. -->

# SELFHOST-004 — run tracing + per-run cost budgeting view (EPIC)

Spec: [`.agents/spec-docs/active/SELFHOST-004-trace-cost-view.md`](../spec-docs/active/SELFHOST-004-trace-cost-view.md)
GATE-APPROVAL: PASSED (iteration 8 ENDORSE, after a REJECT-forced redesign). GATE-IMPLEMENT in progress.

## Recommendation (gate)

A large multi-package epic (agent-core span-timing SOURCE, agent-interface-transport contracts, agent-framework
record-entry + turn cost, agent-transport-protocol carrier, agent-session-analytics read-model, agent-plugin limits
enforcement, transport-tui/gui view). Split into named work units so each is independently testable/mergeable and the
subtle dependency-legality (no `agent-plugin` edge into core/framework/analytics/cli; no `agent-core → transport`
cycle) is preserved slice by slice:

## P1 — turn-granular cost foundation (this slice, TC-06)

- [x] `agent-interface-transport`: add OPTIONAL derived `costUsd?: number` on `IUsageSnapshot` (present iff
      `costStatus !== 'unknown'`; turn-granular). Backward-compatible.
- [x] `agent-framework`: `extractTurnUsage` (`interactive-session-execution.ts`) resolves the turn's model id
      (threaded from the caller's `ctx.getSession().getModelId()`) and computes `costUsd` via `calculateModelCost`
      (the `agent-core/model-pricing.ts` SSOT — exact input/output split), flipping `costStatus` from `'unknown'` to
      `exact` (or leaving `unknown` when the model is unpriced). No `agent-plugin` edge; owns ONLY turn cost.
- [x] Tests (TC-06): `extractTurnUsage` populates `costUsd` + flips `costStatus` for a priced model; leaves it
      absent/`unknown` for an unpriced/absent model.
- [x] Verify: build + typecheck + tests + lint + `pnpm harness:scan`.

## P2 — span timing (agent-core span-completion event + ISpanEntry + framework entry) — TC-07 — DONE

- [x] `agent-core`: `FunctionTool` emits `SPAN_EVENTS.COMPLETED` with a payload JOINING `spanId +
durationMs + op` (raw scalars; no transport/plugin edge — no cycle). `span-events.ts`
      (`SPAN_EVENTS`/`SPAN_EVENT_PREFIX`/`TSpanEvent`/`ISpanCompletionEventData`), `generateSpanId`
      exported, SPEC.md Public API updated.
- [x] `agent-interface-transport`: `ISpanEntry` (`spanId`/`op`/`durationMs`) carried as
      `IHistoryEntry<ISpanEntry>`; exported.
- [x] `agent-framework`: `createSpanEntry(event)` projects the event into the record entry, mirroring
      `createUsageSummaryEntry`; framework owns the transport edge, agent-core does not.
- [x] Tests (TC-07): emit joins the three fields; projection preserves the join + classifies
      `event/span`; dep-direction enforced by `check-dependency-direction` scan.
- [x] Verify: build + typecheck + tests (core 854 / framework 1137 / transport 10) + lint (0 errors) + `pnpm harness:scan` (54/54).

## P3 — trace/cost read-model (`summarizeUsageBySource` timeline + cost-by-source) — TC-01/03 — DONE

- [x] `summarizeUsageBySource` extended: per-source + session `costUsd`/`costExact` (sums exact
      per-turn `IUsageSnapshot.costUsd`; unpriced turns → 0 + inexact); NO cost re-derivation (single
      SSOT path).
- [x] Span `timeline` (`IRunTraceSpan`/`IRunTraceTurn`): buffers span entries and flushes them at each
      usage-summary turn boundary, grouping sub-turn spans under their owning turn + trailing
      in-progress turn. Stays in `agent-core`+`agent-interface-transport` deps (NO `agent-plugin` read).
- [x] Tests (TC-01/03): cost-by-source incl. unpriced-inexact; span grouping incl. trailing turn; pure
      read-model (no throw on huge cost; imports no `agent-plugin`, enforces no budget).
- [x] Verify: build + typecheck (incl. cli/framework consumers) + tests (analytics 29) + lint (0
      errors) + `pnpm harness:scan` (54/54).

## P4 — per-run cumulative budget cap in LimitsPlugin (sessionId, never-reset, exact costUsd) — TC-02/04 — DONE

- [x] `LimitsPlugin`: new `maxRunCost` axis — per-run cumulative cap keyed by `sessionId`, never
      time-resets; accrues each turn's EXACT cost via `calculateModelCost` (same SSOT/PATH as the
      displayed `costUsd`, never the blended estimate); unpriced turns accrue nothing.
- [x] `beforeExecution` halts (throws `PluginError`) once the run's cumulative cost reaches the cap;
      `afterExecution` warns on crossing; `resetLimits(sessionId)` resets at run start;
      `getRunCost`/`getLimitsStatus` surface it. Enforcement stays in the runtime plugin (TC-03/04).
- [x] Tests (TC-02/04): accrue-across-turns/never-reset, halt-on-exceed, per-session keying,
      resetLimits re-allow, unbounded-when-omitted; enforced == `calculateModelCost` exact figure;
      unpriced accrues nothing. Verify: tests (plugin 310) + lint (0 errors) + `harness:scan` (54/54).

## P5 — new TServerMessage carrier + TUI/GUI trace/cost view — TC-05/08 — DONE

- [x] `agent-interface-transport`: OWN the trace/cost read-model as a boundary contract
      (`IUsageBySourceReport`/`IUsageSourceTotals`/`IRunTraceSpan`/`IRunTraceTurn`) — it crosses the
      sidecar; moved from analytics (now imports + re-exports); one SSOT.
- [x] `agent-transport-protocol`: `usage_report` `TServerMessage` carrier + `get-usage-report` request;
      stays within its only dep (transport). TC-08: well-typed + survives JSON WS round-trip.
- [x] `agent-session-analytics`: `formatUsageReport` renders session/per-source cost (`~` inexact
      marker) + span timeline grouped per turn — headless CLI path for the TUI/GUI view (TC-05).
- [x] Verify: build + typecheck (incl. cli/framework consumers) + tests (transport 10 / analytics 32 /
      protocol 52) + lint (0 errors) + `harness:scan` (54/54).

## P6 — LIVE span→history population (real-session timeline) — DONE

Closed the honest gap: the interactive session now populates the span timeline on a REAL turn (not only
over constructed reducer records).

- [x] `agent-session`: the session owns an `ObservableEventService` and injects it into the agent via
      `buildRobota` — the agent previously fell back to the **no-op default**, so tool span emits never
      fired in the interactive path. Exposed read-only via `Session.getEventService()`.
- [x] `agent-session`: the permission wrapper forwards `setEventService` to the ORIGINAL tool (it runs
      `originalExecute` bound to that tool). `Object.create(tool)` would shadow the injection onto the
      wrapper, leaving the original tool's bus unset — no spans. Proven by a wrapper test.
- [x] `agent-framework`: `collectSpanEntries(eventService)` subscribes to the bus and projects each
      `SPAN_EVENTS.COMPLETED` into a record entry (`createSpanEntry`). The interactive turn subscribes
      for the run and drains entries onto `history` BEFORE the turn's `usage-summary` (the reducer's turn
      boundary), then disposes in `finally`.
- [x] Tests: live collector over a real bus (emit→collect→entry; dispose stops it) + wrapper
      `setEventService` forwarding; test fakes updated for the new `getEventService()` contract.
- [x] Verify: build:deps + workspace typecheck + tests (framework 1141 / session 88 + consumers cli 205,
      tui 418) + lint (0 errors) + `harness:scan` (54/54).

The full chain is now live end-to-end: tool emit → session bus → collector → `createSpanEntry` →
`history` → `summarizeUsageBySource` timeline + `formatUsageReport` view.

## GATE-COMPLETE

All completion criteria (TC-01…08) implemented, tested, and dependency-legal; P1–P6 landed. Cost
budgeting + cost-by-source + the span trace timeline are all live in a real interactive session.
Verification is AGENT-RUN (headless unit/integration tests over real objects + the `session analyze`
headless CLI render path) — no owner manual smoke required.

## Test Plan

Maps the spec's Completion Criteria to the planned verification (this slice = TC-06; others in later slices):

- **TC-06** (`extractTurnUsage` populates `costUsd`) → vitest unit in `agent-framework`.
- TC-01/02/03/04/05/07/08 → P2–P5 (see the spec Test Plan).
