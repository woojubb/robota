# Agent Web UI

The browser **remote** (WebRTC) surface for a running `agent-cli` session, plus the self-contained
`SessionMonitor` widget for the web app. The shared GUI presentation core — the session reducer, the view
components (`ConversationView`, `AgentActivityPanel`, `PermissionPrompt`), the localhost WebSocket client, and
the permission/ask prompt state — lives in [`@robota-sdk/agent-transport-gui`](../agent-transport-gui) and is
imported directly from there (this package does not re-export it).

> This package is **private** and not published to npm. It is internal to the Robota monorepo and used via
> workspace references. It is browser-only and requires React 18+.
>
> **GUI Phase-2 (planned):** to be absorbed/retired once the web GUI surface is unified over
> `agent-transport-gui` on the same footing as the desktop app (`apps/agent-app`).

## Quick Start

Embed the localhost-WS monitor widget:

```tsx
import { SessionMonitor } from '@robota-sdk/agent-web-ui';

function App() {
  return <SessionMonitor url="ws://localhost:3001" className="my-monitor" />;
}
```

`SessionMonitor` composes the shared GUI core, connects to the CLI sidecar's WebSocket endpoint, replays
history, and renders the conversation in real time.

## Components & Hooks

### `SessionMonitor`

Self-contained localhost-WS widget. Renders connection status, conversation history, and a prompt input.

```tsx
<SessionMonitor url="ws://localhost:3001" />
```

### `RemoteClient` + `useRtcSession`

The REMOTE-009 Stage-D peer: reads the pairing URL, pairs over WebRTC, and co-drives the SAME session. Render
`RemoteClient` at the fragment-injected `spa/remote.html` entry; `useRtcSession` binds the shared reducer to
the WebRTC client.

```tsx
import { useRtcSession } from '@robota-sdk/agent-web-ui';

declare const relayUrl: string, rendezvous: string, secret: string;
const state = useRtcSession({ relayUrl, rendezvous, secret });
```

For the shared conversation view / composer components, import from
[`@robota-sdk/agent-transport-gui`](../agent-transport-gui).

## Architecture

```
SessionMonitor(wsUrl) ─┐                    RemoteClient ── useRtcSession({relay,…})
                       │                          │
              useWsSession (agent-transport-gui)  └── createRtcSessionClient (this package)
                       │                                    └── useSessionClient<TSessionStatus>
                       └────────── shared reducer ──────────────  (agent-transport-gui)
```

## Dependencies

- `react` ^18 (peer)
- `@robota-sdk/agent-transport-gui` (the shared GUI core: reducer, components, WS client, prompt state)
- `@robota-sdk/agent-transport-protocol` (wire message types)
- `@robota-sdk/agent-remote-pairing` (isomorphic pairing crypto + DTLS channel binding)

## Links

- [GitHub](https://github.com/woojubb/robota)
