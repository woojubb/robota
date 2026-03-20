# DAG Orchestrator Server

`@robota-sdk/dag-orchestrator-server` is the API gateway for the Robota DAG system. It exposes REST and WebSocket endpoints for DAG management, cost evaluation, and orchestrated execution. It sits between client applications and the DAG runtime, applying orchestration policies such as cost checks, retry logic, and authentication.

## Usage

```bash
# Development
pnpm --filter @robota-sdk/dag-orchestrator-server dev

# Production
pnpm --filter @robota-sdk/dag-orchestrator-server build
pnpm --filter @robota-sdk/dag-orchestrator-server start
```

## Specification

See [SPEC.md](./SPEC.md) for the full contract and API surface.
