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

## External ComfyUI Verification

Use this path when validating that the orchestrator works with a real ComfyUI backend instead of
`dag-runtime-server`:

```bash
# Terminal 1: build and run ComfyUI from official source
pnpm dag:comfyui:up

# Terminal 2: run the orchestrator against that backend
BACKEND_URL=http://127.0.0.1:8188 \
CORS_ORIGINS=http://localhost:3002 \
pnpm --filter @robota-sdk/dag-orchestrator-server dev

# Terminal 3: verify runtime routes, orchestrator proxying, WS, and asset upload
pnpm dag:comfyui:verify
```

The default Docker build installs CPU PyTorch and is intended for route/proxy verification. Full
workflow execution requires appropriate ComfyUI models and may need a CUDA PyTorch index or a
separate GPU image policy.

## Specification

See [SPEC.md](./SPEC.md) for the full contract and API surface.
