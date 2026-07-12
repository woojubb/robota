# Deployment Guide

This app (`robota-web`) is a minimal Next.js 15 host for the Robota Agent Playground and the CLI
second-screen monitor. It ships no authentication, database, or Firebase integration — deployment is
limited to building the Next.js app and pointing it at the WebSocket endpoints it talks to. See
[`SPEC.md`](./SPEC.md) for the authoritative scope and route list.

## Routes

- `/` — redirects to `/playground`.
- `/playground` — Playground main page (`PlaygroundApp` from `@robota-sdk/agent-playground/client`).
- `/playground/demo` — Playground demo mode.
- `/monitor` — CLI second-screen browser monitor (`SessionMonitor` from `@robota-sdk/agent-transport-gui/client`).

## Environment Variables

All runtime configuration is optional and public (`NEXT_PUBLIC_*`); there are no secrets. Add any you
need to `.env.local` (local) or your host's environment configuration (production).

| Variable                        | Consumed by                         | Default                | Description                                                     |
| ------------------------------- | ----------------------------------- | ---------------------- | --------------------------------------------------------------- |
| `NEXT_PUBLIC_PLAYGROUND_WS_URL` | `src/app/playground/page.tsx`       | Playground app default | WebSocket URL passed to `PlaygroundApp` as `defaultServerUrl`.  |
| `NEXT_PUBLIC_CLI_WS_URL`        | `src/app/monitor/MonitorClient.tsx` | `ws://localhost:7070`  | WebSocket URL the CLI monitor connects to via `SessionMonitor`. |

Example `.env.local`:

```env
NEXT_PUBLIC_PLAYGROUND_WS_URL=wss://playground.example.com
NEXT_PUBLIC_CLI_WS_URL=wss://cli.example.com
```

## Build and Run

```bash
# Install dependencies (from the monorepo root)
pnpm install

# Build workspace dependencies, then this app
pnpm --filter robota-web... build
pnpm --filter robota-web build

# Local development (serves on port 7071)
pnpm --filter robota-web dev

# Production
pnpm --filter robota-web build
pnpm --filter robota-web start
```

`next.config.ts` disables Node builtin polyfills for the browser bundle so Node-only optional exports
from workspace packages never enter the client build. Type errors fail the build; ESLint is enforced
separately in CI, not during the build.

## Deployment Notes

- The app is stateless. It renders the Playground and Monitor UIs and connects to WebSocket endpoints
  at runtime — point `NEXT_PUBLIC_PLAYGROUND_WS_URL` and `NEXT_PUBLIC_CLI_WS_URL` at the reachable
  playground/CLI servers for your environment.
- Any standard Next.js 15 host (Node server or a platform with Next.js support) works. Run
  `pnpm --filter robota-web build` followed by `pnpm --filter robota-web start`, or use your
  platform's Next.js build integration.
