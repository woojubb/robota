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

- [ ] `agent-interface-transport`: add OPTIONAL derived `costUsd?: number` on `IUsageSnapshot` (present iff
      `costStatus !== 'unknown'`; turn-granular). Backward-compatible.
- [ ] `agent-framework`: `extractTurnUsage` (`interactive-session-execution.ts`) resolves the turn's model id
      (threaded from the caller's `ctx.getSession().getModelId()`) and computes `costUsd` via `calculateModelCost`
      (the `agent-core/model-pricing.ts` SSOT — exact input/output split), flipping `costStatus` from `'unknown'` to
      `exact` (or leaving `unknown` when the model is unpriced). No `agent-plugin` edge; owns ONLY turn cost.
- [ ] Tests (TC-06): `extractTurnUsage` populates `costUsd` + flips `costStatus` for a priced model; leaves it
      absent/`unknown` for an unpriced/absent model.
- [ ] Verify: build + typecheck + tests + lint + `pnpm harness:scan`.

## P2 — span timing (agent-core span-completion event + ISpanEntry + framework entry) — TC-07 — PENDING

## P3 — trace/cost read-model (`summarizeUsageBySource` timeline + cost-by-source) — TC-01/03 — PENDING

## P4 — per-run cumulative budget cap in LimitsPlugin (sessionId, never-reset, exact costUsd) — TC-02/04 — PENDING

## P5 — new TServerMessage carrier + TUI/GUI trace/cost view — TC-05/08 — PENDING

## Test Plan

Maps the spec's Completion Criteria to the planned verification (this slice = TC-06; others in later slices):

- **TC-06** (`extractTurnUsage` populates `costUsd`) → vitest unit in `agent-framework`.
- TC-01/02/03/04/05/07/08 → P2–P5 (see the spec Test Plan).
