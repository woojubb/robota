# SPEC.md — @robota-sdk/agent-web-monitor

## Scope

`agent-web-monitor` is the **CLI-served web GUI**: a minimal Vite SPA with two static pages, composed over the
shared GUI presentation core. It is the **web** sibling of the desktop app `apps/agent-app` (GUI-006), the web
half of the taxonomy `GUI = app | web`.

- **`index.html`** — the localhost-WS **monitor** page: mounts `SessionMonitor` from
  `@robota-sdk/agent-transport-gui`. `agent-cli`'s WS sidecar serves it; the WS URL is injected via a
  `<meta name="ws-url">` tag (fallback: same host).
- **`remote.html`** — the Stage-D browser **remote** page: mounts `RemoteClient` from
  `@robota-sdk/agent-transport-webrtc-web`. Connection inputs come from this page's own URL (relay ← query,
  rendezvous + secret ← fragment).

`agent-cli` builds this app and copies `dist/` into `agent-cli/dist/web`, then serves it (the monitor at the
sidecar root, the Stage-D page as the `clientUrl` target).

## Boundaries

- Owns NO session/command/permission/pairing logic — those run in the spawned `robota` sidecar / host and are
  reached over WS or the RTC data channel. This app is a thin composition of the shared core + the browser
  transport peer.
- Depends on `@robota-sdk/agent-transport-gui` (SessionMonitor + theme) + `@robota-sdk/agent-transport-webrtc-web`
  (RemoteClient) + `react`/`react-dom`. Dev: `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss`,
  `playwright`, `typescript`. **No `agent-framework`/`agent-core`.**
- Owns the Tailwind entry (`src/main.css`: `@import 'tailwindcss'` + the core theme + `@source` over the two
  packages) — the components ship no compiled CSS; this consumer generates it.

## Architecture Overview

```
agent-cli (WS sidecar / remote-control host)
  └── serves agent-cli/dist/web  ← copied from apps/agent-web-monitor/dist
        ├── index.html  → SessionMonitor  (@robota-sdk/agent-transport-gui)
        └── remote.html → RemoteClient    (@robota-sdk/agent-transport-webrtc-web)
```

## Type Ownership

None — this is a private application (`"private": true`), not a library. It exports no package API.

## Public API Surface

None (application).

## Extension Points

- A future unified web GUI could render the shared `SessionSurface` here instead of `SessionMonitor` if the
  CLI-served page should match the desktop shell.

## Error Taxonomy

- Monitor page: connection failures surface through `SessionMonitor`'s status strip (disconnected/connecting/
  error). Remote page: invalid pairing links render `RemoteClient`'s fail-closed "Cannot pair" state.

## Test Strategy

- **Headless web smoke (`e2e/run-smoke.mjs`, `pnpm --filter @robota-sdk/agent-web-monitor test:e2e`):** serves
  the built `dist/` and loads BOTH pages in headless Chromium (Playwright) — asserts the monitor renders the
  `SessionMonitor` shell and the remote page mounts `RemoteClient` — with screenshots. Agent-owned (never
  deferred to the owner).

## Class Contract Registry

None (application; no exported classes/functions).
