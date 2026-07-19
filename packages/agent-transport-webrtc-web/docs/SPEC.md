# SPEC.md — @robota-sdk/agent-transport-webrtc-web

## Scope

The **browser** WebRTC transport peer for a robota session (REMOTE-009 Stage D) — the browser mirror of the
node-side host transport `@robota-sdk/agent-transport-webrtc`. It opens the pairing URL, answers the host's
WebRTC offer over a **native** `RTCPeerConnection`, runs the directional-HMAC pairing handshake as RESPONDER
behind a fail-closed gate, and co-drives the SAME session over an `RTCDataChannel` — swapping WebSocket for the
data channel while reusing the shared session reducer from `@robota-sdk/agent-transport-gui`.

Provides:

- **`useRtcSession({relayUrl,rendezvous,secret,iceServers?,forceTurn?})`** — binds the shared
  `useSessionClient` reducer to the WebRTC client, widening the status union with the RTC pairing/failed states
  (`TSessionStatus = TConnectionStatus | TRtcConnectionStatus`).
- **`RemoteClient`** — the Stage-D page root: reads its connection inputs from its own URL
  (`parseRemoteClientLocation`: relay ← query, rendezvous + secret ← fragment), pairs, and renders the session +
  the owner's permission/ask prompts using the shared `ConversationView` / `PermissionPrompt`.
- **`createRtcSessionClient`** — the answerer + `ResponderGate` (fail-closed pairing routing switch, session
  exposed ONLY post-accept) + data-channel session client, incl. E3 TOFU device credentials and E4
  session-resume.
- **`createRtcSignalingClient`** — a browser `ISignalingClient` over the native `WebSocket`.
- **`parseRemoteClientLocation`** — parse the Stage-D page URL (relay/ice ← query, rendezvous + secret ←
  fragment; the secret never leaves the browser).

This package sits in the **transport** layer (per-concern transport sibling of `agent-transport-webrtc`). It is
browser-only. It reuses the isomorphic zero-dep `@robota-sdk/agent-remote-pairing` leaf and takes **no**
`agent-transport-webrtc`/`werift` dependency (that is node-only).

## Boundaries

- Does NOT own the session reducer, the view components, or the localhost WS client — those are the shared GUI
  core `@robota-sdk/agent-transport-gui`, imported directly (NOT re-exported — no pass-through).
- Does NOT own the WS/RTC wire protocol framing — that is `@robota-sdk/agent-transport-protocol`.
- Does NOT own the pairing CRYPTO — the directional-HMAC handshake + DTLS-fingerprint channel binding is the
  isomorphic zero-dep `@robota-sdk/agent-remote-pairing` leaf.
- Does NOT own the node host transport (offerer, werift) — that is `@robota-sdk/agent-transport-webrtc`.
- OWNS: the browser WebRTC remote client (`createRtcSessionClient`, `createRtcSignalingClient`, `ResponderGate`,
  `parseRemoteClientLocation`, the device-credential store, ICE parsing), the `useRtcSession` hook, and the
  `RemoteClient` page.
- OWNS: `TRtcConnectionStatus` (adds `pairing | failed`) + `TSessionStatus` (its union with the core's
  `TConnectionStatus`).

## Architecture Overview

```
remote.html (paired peer)
  └── RemoteClient
        └── useRtcSession({relay,rendezvous,secret})
              └── createRtcSessionClient (answerer + ResponderGate + data-channel client)
                    ├── createRtcSignalingClient (native WebSocket ISignalingClient)
                    ├── agent-remote-pairing (directional-HMAC + DTLS channel binding)
                    └── useSessionClient<TSessionStatus>  (agent-transport-gui reducer)
                          └── agent-transport-protocol (TServerMessage / TClientMessage)
```

`useRtcSession` instantiates the shared `useSessionClient<TSessionStatus>` generic — keeping the RTC-only status
states out of the core (the core does not depend on this package; no cycle).

## Type Ownership

| Type / value                                                                                       | Owner                                  |
| -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `TRtcConnectionStatus`                                                                             | this package (`rtc-session-client.ts`) |
| `TSessionStatus`                                                                                   | this package (`useRtcSession.ts`)      |
| `IWsSessionState`, `TConnectionStatus`, `useSessionClient`, `ConversationView`, `PermissionPrompt` | `@robota-sdk/agent-transport-gui`      |
| `TServerMessage`, `TClientMessage`                                                                 | `@robota-sdk/agent-transport-protocol` |
| pairing handshake / channel binding                                                                | `@robota-sdk/agent-remote-pairing`     |

## Public API Surface

Exported from the package root (node) and `./client` (browser):

| Export                      | Kind      | Description                                                             |
| --------------------------- | --------- | ----------------------------------------------------------------------- |
| `RemoteClient`              | component | Stage-D page root: reads the pairing URL, pairs over WebRTC, renders it |
| `useRtcSession`             | hook      | Binds the shared reducer to the WebRTC client                           |
| `createRtcSessionClient`    | function  | Answerer + fail-closed gate + data-channel session client               |
| `createRtcSignalingClient`  | function  | Browser `ISignalingClient` over the native `WebSocket`                  |
| `parseRemoteClientLocation` | function  | Parse the Stage-D page URL (relay ← query, secret ← fragment)           |
| `TRtcConnectionStatus`      | type      | RTC lifecycle additions (`pairing`, `failed`)                           |
| `TSessionStatus`            | type      | Union of the WS + RTC connection statuses                               |

The shared reducer + view components are imported from `@robota-sdk/agent-transport-gui` and are NOT re-exported
here (no pass-through re-exports).

## Extension Points

- `useRtcSession` is the template for binding any additional browser transport to the shared reducer.
- The gate/credential/resume pieces (`ResponderGate`, `device-credential-store`) are the browser half of the
  REMOTE-012/013 TOFU + session-resume protocol, paired with the node host transport.

## Error Taxonomy

| Source                   | Behavior                                                               |
| ------------------------ | ---------------------------------------------------------------------- |
| Pairing rejected / drop  | `ResponderGate` fails closed; status → `failed`; session never exposed |
| Rogue host (E3)          | Pinned-key mismatch on reconnect → fail closed (no session)            |
| Reconnect exhausted (E4) | Bounded warm-reconnect loop gives up → status `failed`                 |
| Invalid pairing link     | `RemoteClient` renders the "Cannot pair" state (no session)            |

## Test Strategy

- `src/client/__tests__/` — the responder gate (incl. E3), session client, signaling, credential store, ICE
  parsing, location parsing, and fingerprint parity (REMOTE-009..013). The shared reducer + WS client are tested
  in `agent-transport-gui`.

## Class Contract Registry

### Functions / Hooks

| Export                      | Defined In                            | Notes                                                        |
| --------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `useRtcSession`             | `src/hooks/useRtcSession.ts`          | Binds `useSessionClient<TSessionStatus>` (from the GUI core) |
| `createRtcSessionClient`    | `src/client/rtc-session-client.ts`    | Answerer + gate + data-channel session client                |
| `createRtcSignalingClient`  | `src/client/rtc-signaling.ts`         | Native-`WebSocket` `ISignalingClient`                        |
| `parseRemoteClientLocation` | `src/client/parse-remote-location.ts` | Relay ← query, secret ← fragment                             |

### Components

| Component      | Defined In                        | Notes                                                        |
| -------------- | --------------------------------- | ------------------------------------------------------------ |
| `RemoteClient` | `src/components/RemoteClient.tsx` | `'use client'`; Stage-D pairing root; renders shared session |

### Cross-Package Consumers

- `apps/agent-web` `/remote` route mounts `RemoteClient`.
