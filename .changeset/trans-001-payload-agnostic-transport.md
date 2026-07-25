---
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-transport-protocol': minor
'@robota-sdk/agent-transport-ws': minor
---

TRANS-001: payload-agnostic transport — opaque binary frames + consumer-declared event types

The WS transport now carries **arbitrary payloads** alongside the text-agent protocol on one
connection, instead of forcing every app-level payload through the `text_delta`/`submit` wire
protocol.

- `agent-interface-transport` adds the channel contracts (`IBinaryFrame`, `IChannelEventFrame`,
  `IChannelDescriptor`, `IPayloadChannel`, `IPayloadChannelHost`, `TChannelEventMap`,
  `TChannelFrame`, `TChannelReceiveResult`). Content-neutral carrier mechanics — no payload domain.
- `agent-transport-protocol` adds the pure channel frame codec (`encodeBinaryFrame`,
  `encodeChannelEventFrame`, `decodeChannelFrame`, `isChannelFrame`). `TClientMessage` /
  `TServerMessage` are unchanged.
- `agent-transport-ws` becomes a carrier that routes by WebSocket frame opcode — TEXT to the
  text-agent protocol profile, BINARY to consumer-declared channels — and `WsTransport` now
  implements `IPayloadChannelHost` (`registerChannel`). `PayloadChannelRegistry` is exported.

Additive only: existing transports, consumers, and the agent wire protocol are untouched.
