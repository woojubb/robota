# @robota-sdk/agent-organization

Public, dependency-free canonical JSON and organization resource budget contracts. The package has no broker, ledger, transport, signing or hosted authority API.

```ts
import { organizationCanonical, organizationBudget, organizationUnits } from '@robota-sdk/agent-organization';
import type { IOrganizationBudget, IOrganizationUnits } from '@robota-sdk/agent-organization';

const units: IOrganizationUnits = organizationUnits({ tokens: 100, timeMs: 1_000, costMicros: 50 });
const budget: IOrganizationBudget = organizationBudget({ ...units, concurrency: 1 });
const encoded = organizationCanonical({ budget });
```

`organizationCanonical` accepts JSON primitives, dense arrays and plain objects with safe integer numbers. It sorts object keys by UTF-16 code unit order, uses standard JSON escaping and returns a canonical JSON string. It rejects ambiguous values, cycles, accessors, custom prototypes, invalid Unicode, more than 32 levels, more than 4096 nodes or more than 64 KiB of UTF-8 output. It does not implement full RFC 8785 canonicalization.

`organizationUnits` and `organizationBudget` validate exact object shapes and return frozen snapshots. Every unit is a nonnegative safe integer, negative zero is rejected, and budget concurrency must be at least one. Invalid inputs throw `OrganizationSchemaError` with reason `invalid-schema`. Types alone do not validate runtime data.
