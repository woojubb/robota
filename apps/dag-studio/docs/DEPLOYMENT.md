# Deployment Guide

## Deployable Role

`dag-studio` is the Next.js frontend host for the DAG Designer and Playground routes. It does not
host the DAG API, does not proxy ComfyUI traffic, and does not own run-progress WebSocket handling.

The production DAG topology is:

```text
browser -> dag-studio -> dag-orchestrator-server -> dag-runtime-server or ComfyUI
```

The repository-wide deployment topology is documented in
`.agents/specs/ARCHITECTURE-MAP.md#dag-service-deployment-stack`.

## Environment Variables

Configure these variables in the frontend hosting provider:

```env
NEXT_PUBLIC_DAG_API_BASE_URL=https://dag-orchestrator.example.com
NEXT_PUBLIC_API_VERSION=v1
```

`NEXT_PUBLIC_DAG_API_BASE_URL` is required for deployed DAG Designer usage. It must be the public
origin of `dag-orchestrator-server`, without a trailing slash. Local development defaults to
`http://localhost:3012` when the variable is omitted.

`NEXT_PUBLIC_API_VERSION` only controls the generic `API_CONFIG.baseUrl` value
(`/api/<version>`). DAG Designer calls use `NEXT_PUBLIC_DAG_API_BASE_URL` directly.

## Hosting Contract

- Vercel can host this frontend app, but Vercel Functions must not be treated as the
  `dag-orchestrator-server` runtime because they do not act as a WebSocket server.
- Cloudflare can host the frontend through its Next.js hosting path. Moving the orchestrator to
  Cloudflare would require a Worker/Durable Object rewrite, not a direct Express deployment.
- Do not add Next.js API routes solely to colocate the orchestrator with the frontend. The
  orchestrator owns long-running WebSocket I/O, ComfyUI proxying, and persistence adapter wiring.

## Cross-Service Requirements

- `dag-orchestrator-server` `CORS_ORIGINS` must include the deployed `dag-studio` origin.
- When `NEXT_PUBLIC_DAG_API_BASE_URL` uses `https://`, `dag-designer` opens run-progress streams
  with `wss://` against `/v1/dag/runs/:id/ws`.
- The orchestrator's `BACKEND_URL` must point to the ComfyUI-compatible runtime, not to this
  frontend app.
