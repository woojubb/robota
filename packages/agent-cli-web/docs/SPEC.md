# @robota-sdk/agent-cli-web — SPEC

## Scope

`agent-cli-web` is the CLI's built-in **web monitor SPA** (GUI-007): a minimal Vite single-page app whose one
entry (`index.html` → `src/main.tsx`) mounts `SessionMonitor` from the shared GUI core
(`@robota-sdk/agent-transport-gui/client`) over a localhost WebSocket. It reads the live WS URL from a
server-injected `<meta name="ws-url">` tag. The workspace artifact graph builds this package before CLI assembly,
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
other workspace packages; `agent-cli` consumes its complete output through an explicit copied-artifact build edge.

## Dependencies

- `@robota-sdk/agent-transport-gui` (`SessionMonitor` + theme) — the shared GUI presentation core.
- `react` / `react-dom` — the renderer.

## Build

The artifact adapter runs Vite with a fresh generation output directory (single `index.html` entry),
verifies exact compiler emissions, then publishes managed `dist`. CLI assembly copies the pinned,
verified producer generation into its own staged `web/` directory before publishing its complete
output. A web-only change selects CLI reassembly through the copied-artifact reverse edge; neither
root nor affected assembly relies on recursive package build scripts. The GUI library imports the
protocol package's published browser-safe `./client` entrypoint; this SPA carries no package alias or
private source-path workaround for protocol decoding.
