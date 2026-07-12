---
title: 'SEC-001: authenticate the default (defaultEnabled) loopback WebSocket path'
status: todo
created: 2026-07-12
priority: high
urgency: soon
area: packages/agent-transport-ws, packages/agent-transport-gui, packages/agent-cli
depends_on: []
---

# SEC-001: authenticate the default loopback WebSocket path

> Filed by GUI-002 (companion SECURITY backlog). GUI-002 closed the unauthenticated-loopback hole **only
> for its own Electron-spawned sidecar** (via a required per-launch token on `WsTransport`). The **default**
> `defaultEnabled: true` localhost path — used by the plain TUI (`agent-cli`) and `apps/agent-web` — remains
> unauthenticated and is tracked here rather than changed silently under GUI-002.

## Problem / Goal

`WsTransport` runs with `defaultEnabled: true` and, when no token is configured, binds
`new WebSocketServer({ server })` on `127.0.0.1:7070` with **no auth**: every connection immediately
receives full history + the execution-workspace snapshot and is wired to `createWsHandler`, which can
`submit`, `executeCommand`, and **answer permission/ask prompts**. Because browser `WebSocket` connections
are not gated by CORS, **any local process — or any web page open in any browser on the machine — can reach
`ws://127.0.0.1:7070` and fully drive/authorize a running session.** Since permission-answering _is_ the
authorization gate, this is a standing OWNER-PRINCIPLE exposure on the default path.

GUI-002 added the mechanism to fix it (`IWsTransportConfig.token` → reject-before-emit, constant-time
compare) but deliberately left the default path unchanged to avoid scope-creep and a behavior change to the
existing TUI/web flows. This item decides and implements the default-path story.

## Open Questions (resolve in the spec)

- **Default posture:** should `WsTransport` mint a token automatically when none is supplied (secure by
  default, print/expose it for the local client), or stay open-by-default and require opt-in? Weigh against
  the existing TUI/`apps/agent-web` flows that connect with no token today.
- **Local client token delivery:** how do `agent-cli`'s own consumers and `apps/agent-web` obtain the token
  (a token file with `0600` perms in the user dir? a printed URL? an env handshake?) without breaking the
  zero-config local dev experience.
- **Origin/loopback hardening beyond the token:** should the server also check `Origin` / reject non-loopback
  `Host` as defense-in-depth?
- **Backwards compatibility:** a flag / settings toggle for the transition, and whether `defaultEnabled`
  should remain `true`.

## Notes

- The reject-before-emit token mechanism already exists on `WsTransport` (GUI-002); this item is primarily a
  policy + client-delivery decision for the DEFAULT path, plus wiring `apps/agent-web` / the TUI client to
  present the token.
- Coordinate with REMOTE-001 (the WebRTC/remote path already has its own pairing auth; this is only the
  localhost WS path).
- Research-first is NOT required (the mechanism is built); go straight to the spec gate for the policy call.
