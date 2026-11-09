# @robota-sdk/agent-transport

> **Version:** Platform support and entries described here target SDK 3.1.0. Install that
> release after publication; published 3.0.7 packages may have different exports and behavior.

The shared protocol layer under every agent runtime transport. It defines the transport-neutral wire messages
(`TClientMessage` / `TServerMessage`), the session bridge that turns those messages into calls on a live
session, and the delivery helpers a carrier needs (backpressure, resumable delivery, channel framing,
handoff payload chunking). The carriers that put that protocol on a wire live in the same package, one
subpath each: WebSocket, HTTP, MCP, ACP, WebRTC and the owner link. The root, `./client` and `./node` open
no socket or listener; only a carrier subpath does.

## Installation

```bash
npm install @robota-sdk/agent-transport
```

Requires Node.js 22.12 or later. The root and `./client` entry points also run in the browser. The carrier
libraries are optional peer dependencies: install the ones for the carriers you import (see
[Carriers](#carriers)).

## Entry points

| Import path                          | Environment      | What it contains                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@robota-sdk/agent-transport`        | browser and Node | Wire message types, runtime decoders, `createSessionMessageHandler`, `createOutboundDelivery`, `SessionResumeBridge`, channel frame codec, peer-message ledger, handoff chunking, transport admission (`resolveAdmission`, `mintTransportToken`, `bearerCredential`, `credentialMatches`) |
| `@robota-sdk/agent-transport/client` | browser and Node | Only the wire message types and the runtime decoders (`decodeServerMessage`, `decodeClientMessage`, `decodeFrame`)                                                                                                                                                                        |
| `@robota-sdk/agent-transport/node`   | Node only        | OAuth access-token verification (`createAccessTokenVerifier`), the bearer resource-server gate, file transfer, the stdio carrier bridge, handoff integrity (`sealHandoffRecord`, `verifyHandoffPayload`)                                                                                  |

Anything that needs a Node built-in or the network lives under `./node` or a carrier subpath, so a browser
bundle that imports the root or `./client` never pulls one in.

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
belong to `@robota-sdk/agent-interface/session-mobility`; this package seals the serialized record so
the receiver can verify it arrived intact. Check readiness first, then pass the integrity of those
exact bytes to the offer:

```typescript
import {
  assessHandoffReadiness,
  prepareHandoffOffer,
  type IPrepareHandoffOfferInput,
} from '@robota-sdk/agent-interface/session-mobility';
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

## Carriers

Each carrier is its own subpath, so an application bundles and installs only the protocol library it uses.
A carrier imports this package's root and nothing from another carrier.

| Import path                          | What it does                                                                      | Install alongside                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `@robota-sdk/agent-transport/ws`     | Serves a session on a loopback WebSocket server (token-authenticated by default)  | `ws`                                                                                                           |
| `@robota-sdk/agent-transport/http`   | Hono routes for submitting prompts and reading session state over HTTP + SSE      | `hono`                                                                                                         |
| `@robota-sdk/agent-transport/mcp`    | Exposes a session as an MCP server over stdio or Streamable HTTP                  | `@modelcontextprotocol/server`, `@modelcontextprotocol/node`                                                   |
| `@robota-sdk/agent-transport/acp`    | Runs a session as an Agent Client Protocol agent over stdio, for editors          | `@agentclientprotocol/sdk`, `zod`                                                                              |
| `@robota-sdk/agent-transport/webrtc` | Carries a session peer-to-peer over a pairing-gated data channel (Node host side) | `@robota-sdk/agent-remote-pairing`, `ws`, `bittorrent-dht`, `multicast-dns`, `nostr-tools`, `node-datachannel` |
| `@robota-sdk/agent-transport/link`   | Carries the owner link of `agent-keyring` over a local control socket             | `@robota-sdk/agent-keyring`                                                                                    |

Every carrier subpath is Node only except `http`, which reaches no Node built-in. Usage of each is in
[docs/](./docs/README.md): [ws](./docs/ws.md), [http](./docs/http.md), [mcp](./docs/mcp.md),
[acp](./docs/acp.md), [webrtc](./docs/webrtc.md) and [link](./docs/link.md).

The headless (non-interactive text / JSON / stream-JSON) transport and `TransportRegistry`, which
starts and stops a set of transports together, live in `@robota-sdk/agent-framework`. The terminal UI is
`@robota-sdk/agent-ui-terminal`; this package has no React or Ink dependency.

## Dependencies

- `@robota-sdk/agent-core`
- `@robota-sdk/agent-interface` (the `analytics`, `command`, `execution`, `session`, `session-mobility` and
  `transport` contract subpaths)
- `jose` (access-token signature verification under `./node`)

The carrier libraries (`ws`, `hono`, `@modelcontextprotocol/server` and `@modelcontextprotocol/node`,
`@agentclientprotocol/sdk` and `zod`, `bittorrent-dht`, `multicast-dns`, `nostr-tools`,
`node-datachannel`) and the `@robota-sdk/agent-remote-pairing` and `@robota-sdk/agent-keyring` packages are
optional peer dependencies, needed only by the carrier subpath that names them.

## Documentation

- [docs/SPEC.md](./docs/SPEC.md) — package contract and boundaries
- [npm](https://www.npmjs.com/package/@robota-sdk/agent-transport) ·
  [GitHub](__PROJECT_REPOSITORY_URL__)
