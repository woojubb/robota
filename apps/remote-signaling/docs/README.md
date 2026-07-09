# @robota-sdk/remote-signaling

Minimal, content-blind WebRTC **signaling relay** for the Robota remote-control feature (REMOTE-001).

Two NAT'd peers — a host running `agent-cli` with remote-control enabled and an external remote client — exchange
SDP offers/answers and ICE candidates through this relay to open a direct P2P `RTCDataChannel`. The relay only
pairs peers by an opaque rendezvous id and forwards their SDP/ICE blobs verbatim. It holds **no session content**
and imports no Robota runtime package.

> **Stage A status:** no auth/pairing yet (Stage B), binds loopback/ephemeral by default, and is not wired into
> any publish/deploy path. It exposes no network-reachable trusted surface on its own.

## Usage

```ts
import { startSignalingServer } from '@robota-sdk/remote-signaling';

const server = await startSignalingServer({ host: '127.0.0.1', port: 0 });
console.log(`signaling relay on ws://127.0.0.1:${server.port}`);
// ... later
await server.close();
```

## Frame protocol

- `{ type: 'join', rendezvous }` → join a rendezvous (≤2 peers); replies `{ type: 'joined', rendezvous }`.
- `{ type: 'signal', kind, data }` → relay verbatim to the counterpart; `kind ∈ { offer, answer, ice }`.
- Any other frame (or unknown `kind`, or a signal before joining) is rejected with `{ type: 'error', reason }`
  and never forwarded.

See [`SPEC.md`](./SPEC.md) for the full contract.
