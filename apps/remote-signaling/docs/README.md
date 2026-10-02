# @robota-sdk/remote-signaling

Minimal, content-blind WebRTC **signaling relay** for a configured CLI remote-control client (internal, not published to
npm).

Two NAT'd peers — a host running `agent-cli` with remote control enabled and an external remote client —
exchange SDP offers/answers and ICE candidates through this relay to open a direct P2P `RTCDataChannel`.
The relay pairs peers by an opaque rendezvous id and forwards their SDP/ICE blobs verbatim. It also carries
opaque messages between device inboxes (see below). It holds **no session content**, never inspects a
payload, and uses no runtime SDK package at run time.

The relay has no authentication of its own. The peers authenticate each other end to end over the data channel
(a pairing secret bound to the DTLS channel, `@robota-sdk/agent-remote-pairing`), so the relay cannot
impersonate either side. It is hardened against abuse by default — per-source join rate limits, single-use
rendezvous ids, expiry of half-open rendezvous, frame-size, connection and message-rate caps — and a host can
add its own admission check through the `onJoinAttempt` hook.

It binds loopback on an ephemeral port by default and is not part of any published or deployed artifact: you
run it yourself, point the configured CLI's `transports.webrtc.options.relayUrl` setting at it, and pass the same URL to
the browser client in the `relay` query parameter of its page (see the
[`apps/agent-web` deployment guide](../../agent-web/docs/DEPLOYMENT.md)).

## Usage

```ts
import { startSignalingServer } from '@robota-sdk/remote-signaling';

const server = await startSignalingServer({ host: '127.0.0.1', port: 0 });
console.log(`signaling relay on ws://127.0.0.1:${server.port}`);
// ... later
await server.close();
```

Behind a reverse proxy, pass `trustProxy: true` so the per-IP connection cap reads the proxy's
`X-Forwarded-For` hop instead of the proxy's own address (or set `maxConnectionsPerIp: 0` to disable that
cap). Relay limits are set through the `relay` option.

## Frame protocol

Rendezvous (host ↔ remote client):

- `{ type: 'join', rendezvous }` → join a rendezvous (at most 2 peers, single-use); replies
  `{ type: 'joined', rendezvous }`.
- `{ type: 'signal', kind, data }` → relayed verbatim to the counterpart; `kind ∈ { offer, answer, ice }`.

Device inboxes:

- `{ type: 'presence', topics }` → declare the opaque, high-entropy topics this connection receives at;
  replies `{ type: 'present', topics: <count> }`. The latest connection to declare a topic holds it.
- `{ type: 'message', topic, data }` → from a connection that has declared presence, delivered verbatim as
  `{ type: 'message', topic, data }` to the topic's holder, or answered `{ type: 'absent', topic }` when
  nobody holds it.

Any other frame — an unknown `kind`, a signal before joining, a frame refused by a rate limit or cap — is
answered with `{ type: 'error', reason }` and never forwarded.

See [`SPEC.md`](./SPEC.md) for the full contract.
