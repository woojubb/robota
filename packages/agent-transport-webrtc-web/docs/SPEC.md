# SPEC.md — @robota-sdk/agent-transport-webrtc-web

## Transport Admission

transport-admission: none — the browser side PRESENTS a credential rather than deciding who may
present one. Its fail-closed pairing gate is the client half of the host's handshake
(`agent-transport-webrtc`), which is where the admission decision is made.

## Purpose

The **browser** WebRTC transport peer for a robota session — the browser
mirror of the node-side host transport `@robota-sdk/agent-transport-webrtc`. It opens the pairing
URL, answers the host's WebRTC offer over a **native** `RTCPeerConnection`, runs the
directional-HMAC pairing handshake as RESPONDER behind a fail-closed gate, and co-drives the same
session over an `RTCDataChannel` — swapping WebSocket for the data channel while reusing the
shared session reducer from `@robota-sdk/agent-ui-web`.

This package sits in the **transport** layer, browser-only. It reuses the isomorphic zero-dep
`@robota-sdk/agent-remote-pairing` leaf and takes no `agent-transport-webrtc` or node WebRTC dependency
(that is node-only).

## Boundaries

- Does NOT own the session reducer, the view components, or the localhost WS client — those are
  the shared GUI core `@robota-sdk/agent-ui-web`, imported directly (not re-exported — no
  pass-through).
- Does NOT own the WS/RTC wire protocol framing — that is `@robota-sdk/agent-transport`.
- Does NOT own the pairing CRYPTO — the directional-HMAC handshake + DTLS-fingerprint channel
  binding is the isomorphic zero-dep `@robota-sdk/agent-remote-pairing` leaf.
- Does NOT own the node host transport (offerer, node WebRTC implementation) — that is `@robota-sdk/agent-transport-webrtc`.

## Contract

- The session is exposed to the caller only _after_ the fail-closed pairing gate accepts — never
  speculatively before pairing completes. The status reads `connected` only once the host has
  admitted the connection; until then the host operator's approval is pending, and a channel the
  host closes instead of admitting is `refused`, not retried, since retrying only asks again.
- A rejected or dropped pairing, a pinned-key mismatch on reconnect (rogue host), or an exhausted
  warm-reconnect loop all fail closed: status becomes `failed` and no session is exposed.
- The pairing secret is read only from the URL fragment (never the query string) and never leaves
  the browser.
- A connection takes one offer, and the offer must advertise exactly one DTLS fingerprint: the
  browser's DTLS layer accepts a certificate matching any advertised fingerprint, so a single value
  is what makes the bound fingerprint the verified one.

## Design decisions

- Admission is read from the host's first session frame rather than from a frame of its own: the
  host already sends nothing on an accepted channel until its operator decides, so the existing
  vocabulary says it.

- `useRtcSession` widens the shared `useSessionClient` reducer's status union with RTC-only
  pairing/failed states locally, rather than adding those states to the shared core — the core has
  no dependency on this package, avoiding a cycle.
