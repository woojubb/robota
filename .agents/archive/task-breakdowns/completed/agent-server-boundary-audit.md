# Agent Server Boundary Audit

## Status

Completed.

## Created

2026-05-09

## Completed

2026-05-09

## Priority

P2 - keeps app/server responsibilities explicit as remote execution grows.

## Recommendation

Audit the remote execution boundary without rewriting routing. The current code shows no concrete
drift that justifies a refactor: `agent-web` renders the browser-safe Playground client entry,
`agent-server` hosts provider proxying and Playground WebSocket routing, `agent-playground` owns the
reusable execution UI behavior, and `agent-remote-client` owns the transport client.

## Result

- Added `pnpm harness:scan:agent-server-boundary`.
- Wired the scan into `pnpm harness:scan` and harness consistency checks.
- Added regression tests for app/server/playground/remote-client boundary drift.
- Updated `agent-server` and `agent-web` specs with the provider-secret, browser-safe entry, and
  non-ownership boundaries.
- Updated the apps/deployment architecture map to keep remote execution contracts in
  `agent-remote-client` and reusable Playground execution in `agent-playground`.

## Drift Findings

No source drift requiring refactor was found.

Guarded boundaries:

- provider secrets and direct vendor calls stay in `apps/agent-server`;
- browser pages render `@robota-sdk/agent-playground/client` and do not import provider/server
  packages directly;
- reusable Playground execution stays in `packages/agent-playground`;
- remote transport client behavior stays in `packages/agent-remote-client`;
- server routing must not become owner of provider semantics, session policy, or Playground UI
  state.

## Verification

- `pnpm exec vitest run scripts/harness/__tests__/check-agent-server-boundary.test.mjs scripts/harness/__tests__/harness-scripts.test.mjs`
- `pnpm harness:scan:agent-server-boundary`
- `pnpm harness:scan:consistency`
- `pnpm harness:scan`
