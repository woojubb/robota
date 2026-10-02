# @robota-sdk/agent-transport

The shared protocol layer under every agent runtime transport. It defines the transport-neutral wire messages
(`TClientMessage` / `TServerMessage`), the session bridge that turns those messages into calls on a live
session, and the delivery helpers a carrier needs (backpressure, resumable delivery, channel framing,
handoff payload chunking). The WebSocket and WebRTC transports carry its wire protocol, and the HTTP and
MCP transports use its admission and token-verification helpers. It opens no socket or listener of its
own.

## Installation

```bash
npm install @robota-sdk/agent-transport
```

Requires Node.js 22.12 or later. The root and `./client` entry points also run in the browser.

## Entry points

| Import path                          | Environment      | What it contains                                                                                                                                                                                                                                                    |
| ------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@robota-sdk/agent-transport`        | browser and Node | Wire message types, runtime decoders, `createSessionMessageHandler`, `createOutboundDelivery`, `SessionResumeBridge`, channel frame codec, peer-message ledger, handoff chunking                                                                                    |
| `@robota-sdk/agent-transport/client` | browser and Node | Only the wire message types and the runtime decoders (`decodeServerMessage`, `decodeClientMessage`, `decodeFrame`)                                                                                                                                                  |
| `@robota-sdk/agent-transport/node`   | Node only        | Transport admission (`resolveAdmission`, `mintTransportToken`, `credentialMatches`), OAuth access-token verification (`createAccessTokenVerifier`), the bearer resource-server gate, file transfer, handoff integrity (`sealHandoffRecord`, `verifyHandoffPayload`) |

Anything that needs `node:crypto` or the network lives under `./node`, so a browser bundle that imports
the root or `./client` never pulls in a Node built-in.

## Usage: bridging a connection to a session

A carrier (your socket, data channel, or stream) turns each connection into three things: an outbound
sink, a failure policy, and a feed of inbound text frames. The package does the rest.

```typescript
import { createOutboundDelivery, createSessionMessageHandler } from '@robota-sdk/agent-transport';
import type { IProtocolSession, TServerMessage } from '@robota-sdk/agent-transport';

declare const session: IProtocolSession; // e.g. an InteractiveSession from @robota-sdk/agent-framework
declare const socket: { send(text: string): void; close(): void }; // one client connection

// Outbound: every frame to this connection goes through one delivery boundary. A failed send, or a
// peer that stops reading, calls the error handler once; the carrier then closes the connection.
const deliver = createOutboundDelivery(
  (message: TServerMessage) => socket.send(JSON.stringify(message)),
  () => socket.close(),
);

const handler = createSessionMessageHandler({ session, deliver });

// Inbound: pass each raw text frame from the client; call cleanup when the connection closes.
handler.onMessage(JSON.stringify({ type: 'submit', prompt: 'Hello' }));
handler.cleanup();
```

`onMessage` decodes and validates the frame itself; malformed input is answered with a protocol error,
not thrown. Pass `role: 'observe'` for a read-only connection: it can read the session's conversation
and state but cannot submit, answer prompts or control the session.

## Composing a handoff offer

Moving a session to another device is split between two packages. Readiness and the offer policy
belong to `@robota-sdk/agent-interface-session-mobility`; this package seals the serialized record so
the receiver can verify it arrived intact. Check readiness first, then pass the integrity of those
exact bytes to the offer:

```typescript
import {
  assessHandoffReadiness,
  prepareHandoffOffer,
  type IPrepareHandoffOfferInput,
} from '@robota-sdk/agent-interface-session-mobility';
import { sealHandoffRecord } from '@robota-sdk/agent-transport/node';

function buildOffer(request: Omit<IPrepareHandoffOfferInput, 'integrity'>) {
  const readiness = assessHandoffReadiness(request.runtime);
  if (!readiness.ready) return readiness;

  const { serialized, integrity } = sealHandoffRecord(request.record);
  const offer = prepareHandoffOffer({ ...request, integrity });
  if (!offer.built) return offer;

  // Send serialized unchanged: offer.manifest.integrity describes these exact bytes.
  return { manifest: offer.manifest, serialized };
}
```

The receiver checks the bytes against `offer.manifest.integrity` with `verifyHandoffPayload` before
parsing them. A payload too large for one frame can be split with `chunkHandoffPayload` and reassembled
with `HandoffChunkAssembler`.

## Transport packages

Each carrier is its own package, so an application installs only the protocol dependencies it uses.

| Transport | Package                                                                     | What it does                                                                      |
| --------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| WebSocket | [`@robota-sdk/agent-transport-ws`](../agent-transport-ws/README.md)         | Serves a session on a loopback WebSocket server (token-authenticated by default)  |
| HTTP      | [`@robota-sdk/agent-transport-http`](../agent-transport-http/README.md)     | Hono routes for submitting prompts and reading session state over HTTP + SSE      |
| MCP       | [`@robota-sdk/agent-transport-mcp`](../agent-transport-mcp/README.md)       | Exposes a session as an MCP server over stdio or Streamable HTTP                  |
| WebRTC    | [`@robota-sdk/agent-transport-webrtc`](../agent-transport-webrtc/README.md) | Carries a session peer-to-peer over a pairing-gated data channel (Node host side) |

The headless (non-interactive text / JSON / stream-JSON) transport and `TransportRegistry`, which
starts and stops a set of transports together, live in `@robota-sdk/agent-framework`. The terminal UI is
`@robota-sdk/agent-ui-terminal`; this package has no React or Ink dependency.

## Dependencies

- `@robota-sdk/agent-core`
- `@robota-sdk/agent-interface-analytics`, `-command`, `-execution`, `-session`, `-session-mobility`,
  `-transport` (contract packages)
- `jose` (access-token signature verification under `./node`)

The protocol libraries (`ws`, `hono`, `@modelcontextprotocol/sdk`, `node-datachannel`) are
dependencies of the individual transport packages, not of this one.

## Documentation

- [docs/SPEC.md](./docs/SPEC.md) — package contract and boundaries
- [npm](https://www.npmjs.com/package/@robota-sdk/agent-transport) ·
  [GitHub](__PROJECT_REPOSITORY_URL__)
