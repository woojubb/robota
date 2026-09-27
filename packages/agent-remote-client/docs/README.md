# @robota-sdk/agent-remote-client

The client-side remote execution layer: `RemoteExecutor` implements `IExecutor` from
`@robota-sdk/agent-core` and sends each provider call to a remote provider-proxy server over HTTP
(a JSON request, or Server-Sent Events for streaming), so the vendor API keys stay on the server. The
server assembles streamed messages; the client forwards text deltas and returns one terminal message.

It is not the client counterpart of `@robota-sdk/agent-transport-http` or
`@robota-sdk/agent-transport-ws`, which serve a running session over a different, session-oriented
protocol. The package is internal (`private: true`, not published to npm).

## Documents

- [SPEC.md](./SPEC.md) — package scope, the streaming contract and error semantics.
- [README](../README.md) — usage, the wire protocol and the export list.
