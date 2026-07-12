# SPEC.md — @robota-sdk/agent-web-ui

## Scope

The browser **remote** (WebRTC) surface for a running `agent-cli` session, plus the self-contained
`SessionMonitor` widget for the web app. The shared GUI presentation core — the session reducer
(`useSessionClient`), the view components (`ConversationView`, `AgentActivityPanel`, `PermissionPrompt`),
the localhost WebSocket client (`createWsSessionClient`), and the permission/ask prompt state — was
extracted to **`@robota-sdk/agent-transport-gui`** (GUI-005) and is imported directly from there (this
package does NOT re-export it — the repo forbids pass-through re-exports). This package owns what is
specific to driving a paired host over WebRTC from the browser.

> **GUI Phase-2 (planned):** this package is slated to be absorbed/retired once the web GUI surface is
> unified over `agent-transport-gui` on the same footing as the desktop app (`apps/agent-app`).

**REMOTE-009 Stage D — browser remote client.** The package is the P2P remote peer: it opens the
pairing URL, answers the host's WebRTC offer over a **native** `RTCPeerConnection`, runs the pairing
handshake as RESPONDER over the data channel, and co-drives the SAME session — swapping WebSocket for
`RTCDataChannel`. It binds the shared reducer (`useSessionClient` from `agent-transport-gui`) via
`useRtcSession({relayUrl,rendezvous,secret})`, widening the status union with the RTC pairing/failed states.
The RTC path adds `createRtcSignalingClient` (native-`WebSocket` `ISignalingClient`), `ResponderGate`
(fail-closed pairing routing switch — session exposed ONLY post-accept, dropped pre-accept non-pairing),
`createRtcSessionClient` (answerer + gate + session client), `parseRemoteClientLocation` (relay ← query,
secret ← fragment), and the `spa/remote.html` fragment-injected static entry (`RemoteClient`). It reuses
the isomorphic zero-dep `@robota-sdk/agent-remote-pairing` leaf and takes **no** `agent-transport-webrtc`
(node/werift) dependency. The permission/ask render+answer (`useWsSession` handles
`permission_request`/`ask_request`/`prompt_resolved`, `PermissionPrompt` component) serves BOTH the WS and
RTC clients — the paired owner answers its OWN prompts (local == remote).

**REMOTE-012 E3 TOFU reconnect.** `ResponderGate` gains E3 admission: on first pair (after B3 accept) it runs an
identity-key **enrollment** exchange — it pins the host's advertised ECDSA public key and advertises the browser
device's public key — before the session is exposed; it can also run a mutual `startDeviceReconnect` that verifies
the host against the pinned key (rogue-host → fail closed). The browser-local `device-credential-store` (IndexedDB,
keyed by `relayOrigin + hostIdentityId`) persists the device's **non-extractable** keypair + the pinned host key
(never serialized, never in a URL). `createRtcSessionClient` takes an optional `deviceCredentials` store (wired from
`useRtcSession`) so first-pair enrolls this device; reconnect INITIATION (reusing a stored credential) is E4. Without
`deviceCredentials` the client is exactly the REMOTE-009 first-pair-only path.

**REMOTE-013 E4 session-resume.** `createRtcSessionClient` dedups incoming seq-stamped messages (`resume`/`ack`
protocol), so on an auto-reconnect it applies only the un-seen tail (a `resume_gap` from the host triggers a
`get-messages` refresh). On a connection drop after a successful connect, if a stored E4 credential exists
(`reconnectSeed`+`reconnectCounter` in the `device-credential-store`), it runs a bounded warm-reconnect loop —
probing `deriveReconnectRendezvous(seed, counter/counter+1)`, reconnecting via the E3 device reconnect (host
verified), sending `resume{lastSeq}`, and advancing the counter resync-on-success — without re-pairing; the
exhausted loop surfaces `failed`. `useRtcSession` wires the credential store; the seed is persisted at first
pair from the pairing `sessionKey` (reserved for E4).

**REMOTE-010 TURN fallback.** `parseRemoteClientLocation` also reads an optional `ice` query param (a base64url
JSON `RTCIceServer[]`, decoded + validated by a browser-local fail-closed decoder — the param is
attacker-influenceable) and a `forceTurn` flag, threaded through `RemoteClient` → `useRtcSession` →
`createRtcSessionClient` (`forceTurn` → `iceTransportPolicy: 'relay'`; requires a TURN server, else fail-closed).
Like `relay=`, the `ice` config rides the query (reaches the page host / QR / history — NOT the fragment-protected
secret, NOT the relay).

This package sits in the **Product shells** layer. It is a pure browser UI library — it does not
own session lifecycle, conversation history, or agent runtime state.

**Distinction from `apps/agent-web`:** `packages/agent-web-ui` is a reusable browser React
component library that exports components for other workspaces to consume. `apps/agent-web` is a
Next.js host application that consumes `packages/agent-web-ui` and deploys the actual web UI. They
share a name prefix but are different layers: this package is a library; the app is a deployment.

## Boundaries

- Does NOT own WebSocket protocol framing — the `TServerMessage`/`TClientMessage` wire protocol is owned by
  `@robota-sdk/agent-transport-protocol` (REMOTE-002 extraction).
- Does NOT own `InteractiveSession` or any SDK/session/runtime contracts — those live in
  `agent-framework`, `agent-session`, `agent-executor`.
- Does NOT own `agent-core` types directly — protocol message types come from `agent-transport-protocol`.
- Does NOT own the CLI sidecar server — that is `agent-cli` (`startWebSidecarServer`).
- Does NOT own the pairing CRYPTO — the directional-HMAC handshake + DTLS-fingerprint channel binding is the
  isomorphic zero-dep `@robota-sdk/agent-remote-pairing` leaf (the only REMOTE-009 dep added). Owns the browser
  responder GATE + answerer glue. Takes **no** `agent-transport-webrtc`/werift dependency (that is node-only).
- Does NOT own the session reducer, the view components (`ConversationView`, `AgentActivityPanel`,
  `PermissionPrompt`), the localhost WebSocket client (`createWsSessionClient`), the permission/ask prompt
  state, or `TConnectionStatus` — those are the shared GUI core `@robota-sdk/agent-transport-gui` (GUI-005),
  imported directly.
- OWNS: browser WebRTC remote client (REMOTE-009): `createRtcSignalingClient`, `ResponderGate`,
  `createRtcSessionClient`, `parseRemoteClientLocation`, `RemoteClient`, the `spa/remote.html` entry, and the
  `useRtcSession` hook (which instantiates the shared `useSessionClient` generic).
- OWNS: `TRtcConnectionStatus` (adds `pairing | failed`) + `TSessionStatus` (its union with the core's
  `TConnectionStatus`).
- OWNS: `SessionMonitor` (the web app's embeddable localhost-WS monitor page, composed over the core).

## Architecture Overview

```
agent-web (browser)                     remote.html (paired peer, REMOTE-009 Stage D)
  └── SessionMonitor(wsUrl)               └── RemoteClient
        └── useWsSession (agent-transport-gui)     └── useRtcSession({relay,rendezvous,secret})
              localhost WS                               └── createRtcSessionClient (this package)
                                                               ├── createRtcSignalingClient (native WS)
                                                               ├── ResponderGate (fail-closed)
                                                               └── useSessionClient<TSessionStatus>
                                                                     (agent-transport-gui reducer)
                                                                         └── agent-transport-protocol
```

`SessionMonitor` composes the shared GUI core (`useWsSession` + `ConversationView` + `AgentActivityPanel`
from `@robota-sdk/agent-transport-gui`) into the web app's embeddable localhost-WS monitor page; it requires a
`wsUrl` prop pointing at the CLI sidecar's WebSocket endpoint.

`RemoteClient` is the Stage-D root: it reads the pairing URL (`parseRemoteClientLocation`), pairs over WebRTC
via `createRtcSessionClient` (answerer + `ResponderGate` + data-channel session client), and renders the
session + prompts using the shared `ConversationView` / `PermissionPrompt`. It binds `useRtcSession`, which
instantiates the shared `useSessionClient<TSessionStatus>` generic — keeping the RTC-only status states
(`pairing | failed`) in this package without the core depending on the RTC client.

## Type Ownership

| Type                   | Location                           | Purpose                                                             |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| `TRtcConnectionStatus` | `src/client/rtc-session-client.ts` | RTC-specific lifecycle additions (`pairing`, `failed`)              |
| `TSessionStatus`       | `src/hooks/useRtcSession.ts`       | Union of the core's `TConnectionStatus` with `TRtcConnectionStatus` |

Note: the session reducer state (`IWsSessionState`, `IConversationMessage`, `IActiveTool`), the prompt state
(`TPendingPrompt`), and `TConnectionStatus` are owned by `@robota-sdk/agent-transport-gui` and imported.
`IExecutionWorkspaceSnapshot` / `IExecutionWorkspaceEntry` come from `@robota-sdk/agent-interface-transport` (used transitively via the `agent-transport-gui` view components).

## Public API Surface

| Export                      | Kind      | Description                                                                                        |
| --------------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `SessionMonitor`            | component | Self-contained localhost-WS monitor widget (composes the GUI core); accepts a `wsUrl` prop         |
| `RemoteClient`              | component | REMOTE-009 Stage D root: reads the pairing URL, pairs over WebRTC, renders the session/prompts     |
| `useRtcSession`             | hook      | REMOTE-009 Stage D: binds the shared reducer to the WebRTC client (`{relayUrl,rendezvous,secret}`) |
| `createRtcSessionClient`    | function  | Browser WebRTC answerer + pairing responder + data-channel session client (REMOTE-009)             |
| `createRtcSignalingClient`  | function  | Browser `ISignalingClient` over the native `WebSocket` (REMOTE-009)                                |
| `parseRemoteClientLocation` | function  | Parse the Stage-D page URL: relay ← query, rendezvous + secret ← fragment (REMOTE-009)             |
| `TRtcConnectionStatus`      | type      | RTC lifecycle additions (`pairing`, `failed`)                                                      |
| `TSessionStatus`            | type      | Union of the WS + RTC connection statuses                                                          |

The shared reducer + view components + WS client + prompt state are imported from
`@robota-sdk/agent-transport-gui` and are NOT re-exported here (no pass-through re-exports).

## Extension Points

- A future unified web GUI surface can render the shared `SessionSurface` / components from
  `agent-transport-gui` directly over its own client, superseding `SessionMonitor` (GUI Phase-2).
- `useRtcSession` is the template for binding any additional browser transport to the shared reducer.

## Error Taxonomy

| Source                   | Behavior                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------- |
| Pairing rejected / drop  | `ResponderGate` fails closed; status transitions to `failed`; session never exposed |
| Rogue host (E3)          | Pinned-key mismatch on reconnect → fail closed (no session)                         |
| Reconnect exhausted (E4) | Bounded warm-reconnect loop gives up → status `failed`                              |

The localhost WS client's malformed-frame / reconnect behavior is owned + tested in `agent-transport-gui`.

## Test Strategy

- The RTC responder gate, session client, signaling, credential store, ICE parsing, and location parsing are
  unit-tested in `src/client/__tests__` (REMOTE-009..013). The shared reducer + WS client are tested in
  `agent-transport-gui`.

## Class Contract Registry

### Functions / Hooks

| Export                      | Defined In                            | Notes                                                        |
| --------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `useRtcSession`             | `src/hooks/useRtcSession.ts`          | Binds `useSessionClient<TSessionStatus>` (from the GUI core) |
| `createRtcSessionClient`    | `src/client/rtc-session-client.ts`    | Answerer + gate + data-channel session client                |
| `createRtcSignalingClient`  | `src/client/rtc-signaling.ts`         | Native-`WebSocket` `ISignalingClient`                        |
| `parseRemoteClientLocation` | `src/client/parse-remote-location.ts` | Relay ← query, secret ← fragment                             |

### Components

| Component        | Defined In                          | Notes                                                            |
| ---------------- | ----------------------------------- | ---------------------------------------------------------------- |
| `SessionMonitor` | `src/components/SessionMonitor.tsx` | `'use client'`; composes the GUI core; prop `wsUrl: string`      |
| `RemoteClient`   | `src/components/RemoteClient.tsx`   | `'use client'`; Stage-D pairing root; renders the shared session |

### Cross-Package Port Consumers

| Port (Owner)                                                                                              | Usage                                                                              |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `useSessionClient` / `ConversationView` / `PermissionPrompt` / `AgentActivityPanel` (agent-transport-gui) | The shared reducer + view components composed by `SessionMonitor` / `RemoteClient` |
| `TServerMessage` / `TClientMessage` (agent-transport-protocol)                                            | The wire protocol the RTC data channel carries                                     |
| `agent-remote-pairing`                                                                                    | The isomorphic pairing crypto + DTLS channel binding                               |
