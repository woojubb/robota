# DAG Cost

`@robota-sdk/dag-cost` provides cost evaluation services for DAG orchestration using CEL (Common Expression Language) formulas. It defines the cost metadata model, a storage port interface, and a CEL-based evaluator for computing estimated and actual execution costs.

## Usage

```typescript
import { CelCostEvaluator } from '@robota-sdk/dag-cost';

const evaluator = new CelCostEvaluator();
const result = evaluator.evaluate('baseCost + surcharge', { baseCost: 10, surcharge: 2 });
```

## Specification

See [SPEC.md](./SPEC.md) for the full contract and API surface.
