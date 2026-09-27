# @robota-sdk/agent-transport-webrtc-web

The browser side of Robota's peer-to-peer remote control. It opens a pairing link, answers the host's
WebRTC offer over the browser's native `RTCPeerConnection`, runs the pairing handshake as the responder,
and only after the host admits the connection renders the live session over the data channel. It is the
browser counterpart of the Node host transport
[`@robota-sdk/agent-transport-webrtc`](../agent-transport-webrtc/README.md).

This package is internal to the Robota monorepo (`private: true`, not published to npm). The web app's
`/remote` page (`apps/agent-web`) loads it from the `./client` entry point. It needs React 18 or later.

## Where it sits

- Pairing crypto (handshake and DTLS-fingerprint binding):
  [`@robota-sdk/agent-remote-pairing`](../agent-remote-pairing/README.md).
- Session reducer and conversation view components: `@robota-sdk/agent-ui-web`, imported directly and not
  re-exported here.
- Wire protocol framing: [`@robota-sdk/agent-transport`](../agent-transport/README.md).

The pairing secret is read only from the URL fragment and never leaves the browser. A rejected pairing, a
pinned-key mismatch on reconnect, or an exhausted reconnect loop fails closed: no session is exposed.

See [docs/README.md](docs/README.md) for the exports and [docs/SPEC.md](docs/SPEC.md) for the contract.
For the user-facing picture, see the
[devices and remote access guide](../../content/guide/devices-and-remote.md).
