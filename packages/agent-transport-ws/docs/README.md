# @robota-sdk/agent-transport-ws

The WebSocket transport for the Robota SDK. `WsTransport` serves a running session on a loopback
WebSocket server that admits only connections presenting a token (minted per launch unless the host
supplies one), so a local client such as a GUI can drive the session in real time.
`createWsTransport` provides the same session bridge over a socket the host already owns.

The wire messages and session handling belong to `@robota-sdk/agent-transport`; this package owns the
socket server, connection admission, per-connection delivery and payload channels that share the
connection with the agent protocol.

## Documents

- [SPEC.md](./SPEC.md) — package contract, admission default and invariants.
- [README](../README.md) — installation, usage and options.
