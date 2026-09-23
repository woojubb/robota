# @robota-sdk/agent-cli-web — SPEC

## Purpose

The CLI's built-in **web monitor SPA**: a minimal Vite single-page app that mounts `SessionMonitor`
from the shared GUI core (`@robota-sdk/agent-ui-web/client`) over a localhost WebSocket, reading the
live WS URL from a server-injected `<meta name="ws-url">` tag. The workspace build assembles this
package before CLI assembly, and the CLI serves it over a localhost HTTP host on
`robota --serve --open` — the CLI owns and serves its own monitor.

It is a **`private` product-shell package** (like `packages/agent-playground`): a product UI
assembled from the shared libraries, not an importable neutral library.

## Contract

- **Not deployable / not published.** No runtime `@robota-sdk` export surface — it is a built asset
  the CLI copies and serves. The deployed browser surfaces (Playground, Stage-D remote) live in
  `apps/agent-web`, not here.
- **Presentation only.** All session logic lives in the engine; the monitor is a thin browser client
  over the WS transport, reusing `agent-ui-web`'s components. It contains no domain logic of its own.
- **Loopback-origin.** Served from `127.0.0.1` by the CLI; authenticates to the WS with the token
  injected into its `ws-url`.
- `agent-cli` consumes this package's complete built output through an explicit copied-artifact build
  edge, not through an import.

## Non-goals

- Ships no importable module and must not be treated as one by other workspace packages.
