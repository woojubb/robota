# @robota-sdk/agent-transport-webrtc-web

## 3.0.0-beta.85

### Patch Changes

- Updated dependencies [9a01e78]
  - @robota-sdk/agent-transport@3.0.0-beta.85
  - @robota-sdk/agent-ui-web@3.0.0-beta.85
  - @robota-sdk/agent-remote-pairing@3.0.0-beta.85

## 3.0.0-beta.84

### Patch Changes

- Updated dependencies [29486da]
- Updated dependencies [e8d70ac]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-ui-web@3.0.0-beta.84
  - @robota-sdk/agent-transport@3.0.0-beta.84
  - @robota-sdk/agent-remote-pairing@3.0.0-beta.84

## 3.0.0-beta.83

### Minor Changes

- e689c8e: Follow-ups to connection approval and `/handoff`.

  - `agent-transport-webrtc-web` — the browser remote client says `Waiting for the host to approve this connection…`
    (`awaiting-approval`) after pairing, and `Connected` only once the host's session answers. A host that closes the
    channel instead is shown as `refused` and is not retried, since a retry would only ask the operator again; a
    first connection lost before the host answered is `failed`. Reconnect attempts count until the host admits a
    connection, so a link that keeps dropping while approval is pending gives up instead of asking again and again.
  - `agent-core`, `agent-session`, `agent-framework` — a turn that did not come from the operator stores its
    `turnSource` (`peer`, `external`, `agent-wakeup`) beside `driverId` on the user message and in the display
    history (`IRunOptions.turnSource`), so a session handed off keeps where each turn came from.
  - `agent-cli` — a `/handoff` resent after a lost confirmation reports what stays behind as it is now, not as it was
    at the first attempt, and after refusing to resend a session that changed, the hand-off status shows that refusal
    instead of the earlier lost confirmation.

### Patch Changes

- eb16da8: The browser remote client runs one warm-reconnect loop at a time. When a reconnected link drops again while the
  previous loop is still waiting on a room, that older loop stops instead of moving on and tearing down the new
  loop's connection.
- f8a8a4d: The GUI surface's design now applies inside a `robota-ui` scope that each of its root components opens,
  so an app with design tokens of its own can embed the surface without either overriding the other. Such
  an app imports `@robota-sdk/agent-ui-web/styles/surface.css` into its Tailwind entry; a page that is only
  the surface keeps importing `styles/theme.css` and puts `robota-ui` on its `<html>`. `RobotaMark` and
  `RobotaWordmark` are exported. The browser remote client (`RemoteClient`) follows the same design, with
  its pairing states centred on the page.
- Updated dependencies [d877de2]
- Updated dependencies [d61e159]
- Updated dependencies [28fa8a7]
- Updated dependencies [963a4e0]
- Updated dependencies [7b72344]
- Updated dependencies [9ecffed]
- Updated dependencies [6ae3f28]
- Updated dependencies [9721162]
- Updated dependencies [57f57f5]
- Updated dependencies [ba822c1]
- Updated dependencies [9721162]
- Updated dependencies [6e6b06b]
- Updated dependencies [57280bf]
- Updated dependencies [18c0d5c]
- Updated dependencies [227ff3a]
- Updated dependencies [f8a8a4d]
  - @robota-sdk/agent-transport@3.0.0-beta.83
  - @robota-sdk/agent-remote-pairing@3.0.0-beta.83
  - @robota-sdk/agent-ui-web@3.0.0-beta.83

## 3.0.0-beta.82

### Patch Changes

- Updated dependencies [e15e22b]
- Updated dependencies [e15e22b]
- Updated dependencies [c7f9203]
- Updated dependencies [189c21e]
- Updated dependencies [5e924ee]
  - @robota-sdk/agent-remote-pairing@3.0.0-beta.82
  - @robota-sdk/agent-transport@3.0.0-beta.82
  - @robota-sdk/agent-ui-web@3.0.0-beta.82

## 3.0.0-beta.81

### Patch Changes

- Updated dependencies [b2e0afe]
- Updated dependencies [44fc732]
  - @robota-sdk/agent-remote-pairing@3.0.0-beta.81
  - @robota-sdk/agent-transport@3.0.0-beta.81
  - @robota-sdk/agent-ui-web@3.0.0-beta.81

## 3.0.0-beta.80

### Minor Changes

- 5ccd1e9: Add the browser remote client (REMOTE-009 Stage D) — the P2P peer that opens the pairing URL and
  co-drives a live session over WebRTC. `agent-web-ui` gains a native-`WebSocket` signaling client, a
  fail-closed responder pairing gate (session exposed only after the DTLS-fingerprint-bound handshake
  accepts), an RTC data-channel session client with the same contract as the WS client, a
  fragment-injected `spa/remote.html` static entry, and the REMOTE-007 permission/ask render+answer
  (the paired owner answers its own prompts — local == remote) shared by both the WS and RTC clients. It
  reuses the isomorphic `@robota-sdk/agent-remote-pairing` leaf and takes no node/werift dependency.
  `agent-cli` removes the fabricated `robota-remote://pair` client-URL default and fails closed when
  `transports.webrtc.options.clientUrl` is unset (no dead link).

  (Bump targets corrected during REL-023 triage: `@robota-sdk/agent-web-ui` was dissolved by GUI-006 (#1141, 2026-07-12) before this work was ever published; the browser client described here now lives in `@robota-sdk/agent-transport-webrtc-web` + `@robota-sdk/agent-remote-client`.)

- 9f602df: Add user-supplied TURN fallback for remote control (REMOTE-010 / Stage E1) so P2P works behind symmetric
  NAT / restrictive firewalls. The host reads + validates `transports.webrtc.options.iceServers`/`forceTurn`
  at the agent-cli composition root (a fail-closed validator narrowing the untyped value → `IIceServer[]`;
  `IWebRtcTransportOptions.iceServers` widened to carry TURN `username`/`credential`), and the browser reads a
  validated `ice`/`forceTurn` pairing-URL query param (fail-closed decoder for the attacker-influenceable value;
  `forceTurn` → `iceTransportPolicy: 'relay'`) — both threaded into their `RTCPeerConnection`. `forceTurn` without
  a TURN server fails closed (else ICE gathers no candidates and silently never connects). Absent ICE config ⇒
  host-candidate-only, unchanged.

  (Bump target corrected during REL-023 triage: `@robota-sdk/agent-web-ui` was dissolved by GUI-006 (#1141, 2026-07-12) before this work was ever published; the browser-side ICE/`forceTurn` handling described here now lives in `@robota-sdk/agent-transport-webrtc-web`.)

### Patch Changes

- 94cc355: REMOTE-002 Stage A: extract the transport-neutral session bridge + wire protocol into a new
  `@robota-sdk/agent-transport-protocol` package (`createWsHandler`, `TClientMessage`/`TServerMessage`); repoint
  `agent-transport-ws` and `agent-web-ui` at it (no pass-through re-export). Add a new
  `@robota-sdk/agent-transport-webrtc` package: a `WebRtcTransport` (`IConfigurableTransport`, `defaultEnabled:false`)
  that carries an `IInteractiveSession` over an `RTCDataChannel` reusing the shared handler, with a lazily-loaded
  optional `werift` peer dependency that throws an explicit "WebRTC transport unavailable" error on absence (never a
  silent no-op). No user-facing enable path and no auth in Stage A (that lands in Stage B); the transport is proven
  by an in-process loopback data-channel round-trip only.

  (Bump target corrected during REL-023 triage: `@robota-sdk/agent-web-ui` was dissolved by GUI-006 (#1141, 2026-07-12) before this work was ever published; its protocol-consumer role now lives in `@robota-sdk/agent-transport-webrtc-web`.)

- Updated dependencies [50d2c9f]
- Updated dependencies [a5961c9]
- Updated dependencies [040f31f]
- Updated dependencies [4c5148e]
- Updated dependencies [0116a29]
- Updated dependencies [e82215f]
- Updated dependencies [9db63ee]
- Updated dependencies [2ebff01]
- Updated dependencies [64ba748]
- Updated dependencies [3244fb8]
- Updated dependencies [1e3f91a]
- Updated dependencies [4f3c075]
- Updated dependencies [2db1b97]
- Updated dependencies [1f45110]
- Updated dependencies [833afe1]
  - @robota-sdk/agent-transport@3.0.0-beta.80
  - @robota-sdk/agent-remote-pairing@3.0.0-beta.80
  - @robota-sdk/agent-ui-web@3.0.0-beta.80
