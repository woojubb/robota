# DAG Cost

Cost evaluation for DAG orchestration using CEL (Common Expression Language) formulas: the
cost-metadata model, its storage and management ports, and the `CelCostEvaluator`.

Every cost comes from a formula; the package holds no pricing logic. Evaluator and management
operations return `TResult<…, IDagError>` and never throw across the public API. Persistence belongs to
adapter packages, and the HTTP transport for cost metadata belongs to
`@robota-sdk/dag-orchestration-client`.

```ts
import { CelCostEvaluator } from '@robota-sdk/dag-cost';

const result = new CelCostEvaluator().evaluate('baseCost + surcharge', {
  baseCost: 10,
  surcharge: 2,
});
if (result.ok) console.log(result.value); // 12
```

## Documents

- [SPEC.md](SPEC.md) — the contract and boundaries.
- [Package README](../README.md) — main exports and a fuller usage example.
