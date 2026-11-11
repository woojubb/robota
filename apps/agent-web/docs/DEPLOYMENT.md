# Deployment Guide

This app (`robota-web`) is a minimal Next.js 15 host for the browser client for the configured CLI remote control.
It ships no authentication, database, or Firebase integration — deployment is limited to building the
Next.js app. See [`SPEC.md`](./SPEC.md) for the app's scope and boundaries.

## Routes

- `/` — redirects to `/remote`.
- `/remote` — browser remote client for the configured CLI remote control (`RemoteClient` from
  `src/remote-client`). Its connection inputs come from its URL, not from environment variables. Set the
  CLI's `transports.webrtc.options.clientUrl` to this page with the signaling relay in
  the `relay` query parameter (for example `https://web.example.com/remote?relay=wss://relay.example.com`;
  optional `ice` and `forceTurn` parameters configure STUN/TURN). The pairing link the configured CLI prints adds the
  rendezvous id and secret in the URL fragment, which the browser never sends to the server.

## Product configuration

The server resolves the product configuration (identity, crypto namespace and browser credential database)
for the page and its title; only the public projection reaches the browser. From the repository source,
select the configuration with `PRODUCT_CONFIG_FILE=/absolute/path/product.env` (see
[product configuration](../../../packages/product-config/README.md)) when you run the commands below. A
generated product workspace bakes the selected public projection into the app, so it needs no environment.

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

The repository root aliases the three app commands: `pnpm web:dev`, `pnpm web:build` and `pnpm web:start`.
Type errors fail the build; ESLint is enforced separately in CI, not during the build.

## Deployment Notes

- The app is stateless and holds no secrets. It renders the remote-client UI, which connects out at
  runtime to the signaling relay named in its pairing link (self-hosted with `apps/remote-signaling`).
- Any standard Next.js 15 host (Node server or a platform with Next.js support) works. Run
  `pnpm --filter robota-web build` followed by `pnpm --filter robota-web start`, or use your
  platform's Next.js build integration.
