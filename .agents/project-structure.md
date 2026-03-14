# Project Structure

```text
packages/
├── agents/             # Core agent functionality
├── anthropic/          # Anthropic provider
├── openai/             # OpenAI provider
├── google/             # Google provider
├── sessions/           # Session management
├── team/               # Team collaboration
├── workflow/           # Workflow visualization/events
├── playground/         # Playground UI package
├── remote/             # Remote execution package
├── dag-core/           # DAG domain contracts and state rules (SSOT)
├── dag-adapters-memory/ # In-memory port adapters (Storage, Queue, Lease, Clock)
├── dag-node/           # Node authoring infrastructure (base class, IO, registries)
├── dag-runtime/        # DAG orchestration runtime
├── dag-worker/         # DAG worker execution layer
├── dag-scheduler/      # DAG scheduler layer
├── dag-projection/     # DAG projection/read-model layer
├── dag-api/            # DAG API/composition layer
├── dag-designer/       # DAG web designer layer
└── dag-nodes/          # DAG node implementations
apps/
├── web/                    # Web application
├── docs/                   # Documentation site
├── agent-server/           # AI provider proxy + Playground WebSocket
├── dag-runtime-server/     # DAG execution server (ComfyUI-compatible)
└── dag-orchestrator-server/ # Orchestration gateway (cost/auth/retry)
```

## DAG Dependency Direction

**Allowed dependency flow (strictly one-way, no cycles):**

```
dag-core  (contracts: interfaces, types, state machines, execution engine)
  ↑
dag-adapters-memory  (in-memory port adapters: Storage, Queue, Lease, Clock)
dag-node  (node infrastructure: base class, IO, registries, schemas)
  ↑
dag-nodes/*  (concrete node implementations)
```

**Rules:**

- `dag-core` is the SSOT contract package. It defines interfaces and types only. It must NOT depend on `dag-node` or any implementation package in production dependencies.
- `dag-adapters-memory` depends on `dag-core` only. It provides lightweight in-memory implementations of port interfaces for testing, local development, and demos.
- `dag-node` depends on `dag-core` for type imports. It provides node authoring infrastructure (classes, factories, registries).
- `dag-nodes/*` depend on both `dag-node` (infrastructure) and `dag-core` (types).
- All other dag packages (`dag-runtime`, `dag-worker`, `dag-scheduler`, `dag-projection`, `dag-api`, `dag-designer`) depend on `dag-core` for contracts.
- `dag-designer` must NOT import runtime, worker, or scheduler implementations directly.
- **Bidirectional dependencies are prohibited.** If package A depends on package B in production dependencies, B must NOT depend on A.
- devDependencies for testing (e.g., using implementation fixtures in contract tests) are allowed and do not constitute a production dependency cycle.
- Pass-through re-exports (`export * from '@robota-sdk/other-package'`) from lower-level to higher-level packages are prohibited. Consumers must import from the owning package directly.
