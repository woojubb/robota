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
  observations into a content-free aggregate snapshot. It emits Gauges rather than additive Sums:
  repeating an export must not claim new usage. Unknown cost and unknown token splits remain
  separately visible instead of becoming invented zero-priced usage. Network delivery belongs to
  the CLI, never to this pure package.

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
