# Deployment Guide

This app (`robota-web`) is a minimal Next.js 15 host for the browser client for the CLI's remote control.
It ships no authentication, database, or Firebase integration — deployment is limited to building the
Next.js app. See [`SPEC.md`](./SPEC.md) for the app's scope and boundaries.

## Routes

- `/` — redirects to `/remote`.
- `/remote` — browser remote client for the CLI's remote control (`RemoteClient` from
  `@robota-sdk/agent-transport-webrtc-web/client`). It takes no environment variables; everything comes
  from its URL. Set the CLI's `transports.webrtc.options.clientUrl` to this page with the signaling relay in
  the `relay` query parameter (for example `https://web.example.com/remote?relay=wss://relay.example.com`;
  optional `ice` and `forceTurn` parameters configure STUN/TURN). The pairing link the CLI prints adds the
  rendezvous id and secret in the URL fragment, which the browser never sends to the server.

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

- The app is stateless and needs no environment variables or secrets. It renders the remote-client UI,
  which connects out at runtime to the signaling relay named in its pairing link (self-hosted with
  `apps/remote-signaling`).
- Any standard Next.js 15 host (Node server or a platform with Next.js support) works. Run
  `pnpm --filter robota-web build` followed by `pnpm --filter robota-web start`, or use your
  platform's Next.js build integration.
