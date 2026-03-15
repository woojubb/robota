# DAG Cost Specification

## Scope

`@robota-sdk/dag-cost` provides cost evaluation services for DAG orchestration using CEL (Common Expression Language) formulas. It defines the cost metadata model and a storage port interface, enabling cost estimation and calculation for DAG node executions.

## Boundaries

- **CEL evaluation only.** Cost computation is delegated to CEL formula evaluation; no hardcoded pricing logic.
- **No persistence.** This package defines the storage port interface (`ICostMetaStoragePort`) but does not implement it. Adapter packages provide concrete implementations.
- **No domain logic beyond cost.** This package does not manage DAG execution, scheduling, or node lifecycle.
- **Result-based error handling.** All evaluator methods return `TResult` — no thrown exceptions cross the public API boundary.

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `@marcbachmann/cel-js` | CEL expression parsing and evaluation |
| `@robota-sdk/dag-core` | `TResult` and `IDagError` types for structured error handling |

## Public API Surface

| Export | Kind | Description |
|--------|------|-------------|
| `CelCostEvaluator` | Class | Evaluates and validates CEL cost formulas against variable contexts |
| `ICostMeta` | Interface | Cost metadata for a node type (formula, category, variables, enabled flag) |
| `TCostMetaCategory` | Type | Union of cost categories: `'ai-inference' \| 'transform' \| 'io' \| 'custom'` |
| `ICostMetaStoragePort` | Interface | Port for CRUD operations on cost metadata (get, getAll, save, delete) |

## Key Behaviors

### CelCostEvaluator

- `evaluate(formula, context)` — Evaluates a CEL formula with the given variable bindings. Returns `TResult<number, IDagError>`. BigInt results are coerced to finite numbers.
- `validate(formula)` — Parses a CEL formula without evaluation to check syntax. Returns `TResult<void, IDagError>`.
- Error codes: `CEL_EVAL_ERROR` (runtime failure), `CEL_PARSE_ERROR` (syntax error), `CEL_NON_NUMERIC` (non-numeric result).

### ICostMeta

Each cost metadata entry contains:
- `nodeType` — identifier for the node type
- `displayName` — human-readable name
- `category` — one of the `TCostMetaCategory` values
- `estimateFormula` — CEL formula for cost estimation (required)
- `calculateFormula` — CEL formula for actual cost calculation (optional)
- `variables` — default variable bindings for the formulas
- `enabled` / `updatedAt` — lifecycle fields

## Use Cases

- **Cost estimation:** Compute estimated costs before executing a DAG run.
- **Cost calculation:** Compute actual costs after execution using runtime variables.
- **Formula validation:** Verify formula syntax at design time in the DAG designer.

## Future Direction

- Additional evaluator backends beyond CEL (e.g., simple arithmetic DSL).
- Cost aggregation utilities for multi-node DAG runs.
