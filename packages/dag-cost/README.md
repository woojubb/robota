# @robota-sdk/dag-cost

Cost evaluation for DAG workflows. Costs are written as CEL (Common Expression Language) formulas
and evaluated by `CelCostEvaluator`; this package also defines the cost-metadata model and the ports
that store and manage it. No pricing is hard-coded here.

Internal package: private to this monorepo (`"private": true`) and not published to npm. It is part of
the DAG workflow subsystem; see [the DAG packages](../dag-core/README.md#the-dag-packages).

## Where it sits

- Depends on: [`@robota-sdk/dag-core`](../dag-core/README.md) (for `TResult` and `IDagError`).
- Used by: [`dag-adapters-local`](../dag-adapters-local/README.md) (`FileCostMetaStorage`),
  [`dag-orchestration-client`](../dag-orchestration-client/README.md) (the cost-metadata HTTP
  client), [`dag-framework`](../dag-framework/README.md) and `apps/dag-runtime-server`.

## Main exports

- `CelCostEvaluator` — `evaluate(formula, context)` returns `TResult<number, IDagError>`;
  `validate(formula)` checks syntax without evaluating.
- `ICostMeta`, `TCostMetaCategory` — a node type's cost metadata: a required `estimateFormula`, an
  optional `calculateFormula` for actual costs, and its variables.
- `ICostMetaStoragePort` — persistence port for cost metadata (implemented in
  `dag-adapters-local`).
- `ICostMetaOperationsPort` and its formula preview/validation input types — the management
  capability hosts expose.

## Usage

```ts
import { CelCostEvaluator } from '@robota-sdk/dag-cost';

const evaluator = new CelCostEvaluator();

const syntax = evaluator.validate('baseCost + surcharge');
if (!syntax.ok) console.error(syntax.error.message);

const result = evaluator.evaluate('baseCost + surcharge', { baseCost: 10, surcharge: 2 });
if (result.ok) {
  console.log(result.value); // 12
} else {
  console.error(result.error.code); // e.g. 'CEL_EVAL_ERROR' or 'CEL_NON_NUMERIC'
}
```

## Documentation

- [docs/README.md](docs/README.md) — overview of this package's docs.
- [docs/SPEC.md](docs/SPEC.md) — the contract and boundaries.
