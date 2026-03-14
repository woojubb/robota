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

- `dag-core` is the SSOT contract package for all DAG packages.
- `dag-node` depends on `dag-core` and provides node authoring infrastructure.
- `dag-core` re-exports `dag-node` symbols for backward compatibility. Dependency direction: `dag-core` -> `dag-node` -> `dag-nodes/*`.
- All other dag packages (`dag-runtime`, `dag-worker`, `dag-scheduler`, `dag-projection`, `dag-api`, `dag-designer`) depend on `dag-core`.
- `dag-nodes/*` depend on `dag-node` for node authoring infrastructure (base class, IO accessor, registries).
- `dag-designer` must NOT import runtime, worker, or scheduler implementations directly.
