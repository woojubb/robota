# DAG Cost Specification

## Purpose

`@robota-sdk/dag-cost` provides cost evaluation for DAG orchestration using CEL (Common Expression
Language) formulas: the cost metadata model, a storage port interface, and CEL-based estimation
and calculation.

## Contract

- Cost computation is delegated entirely to CEL formula evaluation — no hardcoded pricing logic
  lives in this package.
- All evaluator and management operations return `TResult` with `IDagError`; nothing throws across
  the public API boundary.
- A cost metadata entry carries both an `estimateFormula` (required, for pre-execution estimates)
  and an optional `calculateFormula` (for post-execution actuals using runtime variables).
- The management capability's operations report outcomes as domain results, never as HTTP statuses
  or URLs — an implementation that cannot service a request reports a domain-level failure rather
  than fabricating a transport response.

## Boundaries

- Defines `ICostMetaStoragePort` but does not implement it — adapter packages own persistence.
- Does not own the HTTP transport contract for cost metadata; that lives in
  `@robota-sdk/dag-orchestration-client`, which imports this package's domain types.
- Does not manage DAG execution, scheduling, or node lifecycle — cost only.

## Future Direction

- Additional evaluator backends beyond CEL (e.g. a simple arithmetic DSL).
- Cost aggregation utilities for multi-node DAG runs.
