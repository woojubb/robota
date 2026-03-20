# DAG Runtime Server

`@robota-sdk/dag-runtime-server` is a ComfyUI-compatible Prompt API execution server. It registers DAG node implementations, receives prompt payloads, resolves execution graphs, and runs node tasks. It serves as the execution backend that the orchestrator server delegates work to.

## Usage

```bash
# Development
pnpm --filter @robota-sdk/dag-runtime-server dev

# Production
pnpm --filter @robota-sdk/dag-runtime-server build
pnpm --filter @robota-sdk/dag-runtime-server start
```

## Specification

See [SPEC.md](./SPEC.md) for the full contract and API surface.
