# @robota-sdk/agent-web-monitor

The **CLI-served web GUI** — a minimal Vite SPA with two static pages, composed over the shared GUI core. The
web sibling of the desktop app `apps/agent-app` (GUI-006).

- **`index.html`** — the localhost-WS monitor page (`SessionMonitor` from `@robota-sdk/agent-transport-gui`).
- **`remote.html`** — the Stage-D browser remote page (`RemoteClient` from
  `@robota-sdk/agent-transport-webrtc-web`).

`agent-cli` builds this app and copies `dist/` into `agent-cli/dist/web`, then serves it (the monitor at the WS
sidecar root; the Stage-D page as the remote-control `clientUrl`).

## Scripts

```bash
pnpm --filter @robota-sdk/agent-web-monitor build      # Vite build → dist/{index,remote}.html
pnpm --filter @robota-sdk/agent-web-monitor dev        # local dev server
pnpm --filter @robota-sdk/agent-web-monitor test:e2e   # headless Chromium smoke (both pages) + screenshots
```

This app owns no session/pairing logic — it is a thin composition of the shared core + the browser WebRTC
transport peer. See [SPEC.md](./SPEC.md).
