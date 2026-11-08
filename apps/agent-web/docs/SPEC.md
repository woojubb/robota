# Web App Specification

## Purpose

Owns the browser remote application: a Next.js host that serves the client for the configured CLI's remote
control, a second screen for a running session. The client (`src/remote-client`) opens the pairing link,
answers the host's WebRTC offer over the browser's native `RTCPeerConnection`, runs the directional-HMAC
pairing handshake as the responder and renders the live session over the data channel. It is the browser
counterpart of the Node host transport `@robota-sdk/agent-transport-webrtc`, which is where the admission
decision is made; the client presents a credential and decides nothing.

## Contract

- Renders only browser-safe code and never imports provider packages — keeping server-only code out of the
  browser bundle.
- Hosts no API server and holds no secrets: the remote client takes everything it needs from its URL and
  connects out to the signaling relay.
- The session is exposed only after the fail-closed pairing gate accepts. The status reads `connected` once
  the host has admitted the connection; until then the host operator's approval is pending, and a channel the
  host closes instead of admitting is `refused`, not retried, since retrying only asks again.
- A rejected or dropped pairing, a pinned-key mismatch on reconnect (rogue host) and an exhausted
  warm-reconnect loop all fail closed: the status becomes `failed` and no session is exposed.
- The pairing secret is read only from the URL fragment, never the query string, and never leaves the browser.
- A connection takes one offer, and the offer must advertise exactly one DTLS fingerprint: the browser's DTLS
  layer accepts a certificate matching any advertised fingerprint, so a single value is what makes the bound
  fingerprint the verified one.

## Design decisions

- Admission is read from the host's first session frame rather than from a frame of its own: the host already
  sends nothing on an accepted channel until its operator decides, so the existing vocabulary says it.
- `useRtcSession` widens the shared `useSessionClient` status union with the RTC-only pairing and failed
  states locally rather than adding them to `agent-ui-web`, which has no dependency on this app.

## Non-goals

- No package-level runtime or auth logic beyond deployment/frontend integration.
