# agent-session-analytics Specification

## Purpose

Owns session-log **timing and usage analysis and reporting** for the Robota SDK. Given persisted
session records or one immutable host snapshot, it computes per-turn timing intervals (LLM wait vs.
tool execution), aggregates cross-session personal usage into complete local-calendar buckets, and
renders text reports. A pure analysis/observability concern — distinct from session
lifecycle/persistence (`agent-session`) and from any CLI shell.

## Boundaries

- **Pure functions only — no file I/O, no `process.*`, no CLI/transport concerns.** Callers load
  records and write output.
- Operates on the canonical session-record and history-entry projections owned by
  `agent-interface-session` / `agent-core` — owns no duplicate session-record or history-entry
  type itself.
- Depends only on contract/record owners (`agent-interface-analytics`, `agent-interface-session`,
  `agent-core`). No dependency on `agent-session`, `agent-framework`, or any CLI package.
- The trace/cost read-model types this package produces are a **boundary contract owned by
  `agent-interface-analytics`** (they cross the sidecar boundary via a server-message carrier);
  this package computes them and re-exports the types for co-located consumers, but does not own
  them.
- For an explicit OTLP usage export, this package only projects normalized, de-duplicated stored
  observations and root-validated provider calls into separate content-free aggregate snapshots,
  emitting Gauges rather than additive Sums so repeating an export cannot claim new usage or add
  call totals to turn totals; unknown cost and token splits stay separately visible
  instead of becoming invented zero-priced usage. Network delivery belongs to the CLI, never to this
  pure package.
- Explicit prompt-root trace projection reads only canonical observations carrying a complete, valid
  root identity, cannot infer roots from legacy summaries or tool events, and excludes duplicate or
  contradictory roots instead of choosing one. Child spans are included only when their IDs and
  times validate against an accepted root; malformed, orphaned, or duplicate children are counted
  rather than inferred or repaired. Invalid optional usage does not erase a valid lifecycle span.
  It emits no content, provider/model label, or session identity, and these partial spans
  are not proof of final turn settlement or an end-to-end distributed trace.
- Explicit OTLP completion-event projection reuses only these already-accepted spans, emitting one
  fixed, content-free, outcome-only log event per span — a snapshot of recorded completions, not
  live logging or replay-log export. Repeating an export may append the same log records again;
  source-side deduplication does not guarantee collector-side idempotency.

## Contract

- Persisted timestamps arrive as ISO strings at runtime (JSON has no `Date`); all timestamp math
  routes through `new Date(...)`, so both `string` and `Date` inputs are handled uniformly.
- Malformed or empty history never throws — it yields an empty interval set and a "no timing data"
  verdict. I/O and parsing errors are the caller's concern, since records arrive already loaded.

## Consumption posture

This package stays a leaf analysis library and must not be re-absorbed into assembly-layer runtime
dependencies for convenience helpers. `agent-framework` does not carry it as a runtime dependency;
runtime consumers (e.g. `agent-cli`) compose its functions themselves over a neutral session-log
accessor.
