# @robota-sdk/agent-remote-pairing

Pairing and DTLS-fingerprint channel binding for Robota's peer-to-peer remote control. A host proves that
a connecting peer holds a single-use pairing secret and binds that proof to the DTLS channel each side
actually observes, so a signaling relay in the middle is detected. The package also holds the identity
primitives for one user's devices: device keys and reconnect, the master → signing key → device
certificate chain, the device handshake, enrollment with a one-time code, and hand-off grants.

The main entry point is isomorphic (WebCrypto only, no `node:` imports, no WebRTC dependency) and runs on
the Node host and in the browser client; the Node-only `./local` entry point admits peers on the same
machine and user account. The WebRTC transports (`@robota-sdk/agent-transport-webrtc` on the host,
`@robota-sdk/agent-transport-webrtc-web` in the browser) are its callers; it opens no connection itself.

## Documents

- [SPEC.md](./SPEC.md) — security model, the same-user identity chain, `./local` admission and the
  pre-auth wire contract.
- [README](../README.md) — installation, a pairing example and the export overview.
