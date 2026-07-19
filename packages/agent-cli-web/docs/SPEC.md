# @robota-sdk/agent-cli-web — SPEC

## Scope

`agent-cli-web` is the CLI's built-in **web monitor SPA** (GUI-007): a minimal Vite single-page app whose one
entry (`index.html` → `src/main.tsx`) mounts `SessionMonitor` from the shared GUI core
(`@robota-sdk/agent-transport-gui/client`) over a localhost WebSocket. It reads the live WS URL from a
server-injected `<meta name="ws-url">` tag. `agent-cli` builds this package's `dist/` (via `copy-web-assets`)
and serves it over a localhost HTTP host on `robota --serve --open` — the CLI OWNS and SERVES its own monitor.

It is a **`private` product-shell package** (like `packages/agent-playground`), sanctioned under the Library
Neutrality Rule: a product UI assembled from the shared libraries, not an importable neutral library.

## Boundaries

- **Not deployable / not published.** It has no runtime `@robota-sdk` export surface — it is a built asset the
  CLI copies and serves. The deployed browser surfaces (Playground, Stage-D remote) live in `apps/agent-web`.
- **Presentation only.** All session logic lives in the engine; the monitor is a thin browser client over the
  WS transport, reusing `agent-transport-gui`'s components. It contains no domain logic.
- **Loopback-origin.** Served from `127.0.0.1` by the CLI; authenticates to the WS with the SEC-001 token
  injected into its `ws-url`.

## Public API Surface

None — this package ships a built SPA bundle (`dist/`), not an importable module. It has no exports consumed by
other workspace packages; `agent-cli` depends on its `dist/` at build time only (file copy, not a package edge).

## Dependencies

- `@robota-sdk/agent-transport-gui` (`SessionMonitor` + theme) — the shared GUI presentation core.
- `react` / `react-dom` — the renderer.

## Build

`vite build` → `dist/` (single `index.html` entry). `agent-cli`'s build runs this first, then
`scripts/copy-web-assets.mjs` copies `dist/` into `agent-cli/dist/web`.
