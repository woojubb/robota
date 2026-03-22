# DAG Dependency Direction

Parent: [project-structure.md](project-structure.md)

**Allowed dependency flow (strictly one-way, no cycles):**

```
dag-core  (contracts: interfaces, types, state machines, execution engine)
  ↑
dag-cost  (cost domain: CEL evaluator, cost meta types, storage port)
dag-adapters-local  (local adapters: in-memory ports + file-based storage; depends on dag-core + dag-cost)
dag-node  (node infrastructure: base class, IO, registries, schemas)
  ↑
dag-nodes/*  (concrete node implementations)
dag-orchestrator  (orchestration layer; depends on dag-core + dag-cost)
```

**Rules:**

- `dag-core` is the SSOT contract package. It defines interfaces and types only. It must NOT depend on `dag-node` or any implementation package in production dependencies.
- `dag-adapters-local` depends on `dag-core` and `dag-cost`. It provides lightweight local implementations (in-memory and file-based) of port interfaces for testing, local development, and demos.
- `dag-node` depends on `dag-core` for type imports. It provides node authoring infrastructure (classes, factories, registries).
- `dag-nodes/*` depend on both `dag-node` (infrastructure) and `dag-core` (types).
- All other dag packages (`dag-runtime`, `dag-worker`, `dag-scheduler`, `dag-projection`, `dag-api`, `dag-designer`) depend on `dag-core` for contracts.
- `dag-designer` must NOT import runtime, worker, or scheduler implementations directly.
- `dag-designer` has devDependencies on `dag-node-*` packages for testing node catalog and port definitions. These are not production dependencies.
- **Bidirectional dependencies are prohibited.** If package A depends on package B in production dependencies, B must NOT depend on A.
- devDependencies for testing (e.g., using implementation fixtures in contract tests) are allowed and do not constitute a production dependency cycle.
- Pass-through re-exports (`export * from '@robota-sdk/other-package'`) from lower-level to higher-level packages are prohibited. Consumers must import from the owning package directly.
