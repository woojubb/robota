# @robota-sdk/agent-transport

The transport-neutral protocol layer shared by every agent runtime transport: the wire messages a client and
a host exchange, the session bridge that applies them to a live session, and the delivery helpers
(backpressure, resumable delivery, channel framing, handoff chunking) a carrier builds on. It owns no
socket, listener or UI.

The root and `./client` entry points run in the browser; Node-only access-token verification, the
bearer resource-server gate, file transfer, the stdio carrier bridge and handoff integrity helpers
are under `./node`. The carriers are separate subpaths of the same package: `@robota-sdk/agent-transport/ws`,
`/http`, `/mcp`, `/acp`, `/webrtc` and `/link`.

```typescript
// Shared session-message handling and transport admission (browser and Node)
import { createSessionMessageHandler, resolveAdmission } from '@robota-sdk/agent-transport';

// Browser-side runtime decoding
import { decodeServerMessage } from '@robota-sdk/agent-transport/client';

// Node-only access-token verification
import { createAccessTokenVerifier } from '@robota-sdk/agent-transport/node';
```

## Documents

- [SPEC.md](./SPEC.md) — the package contract and ownership boundaries, then each carrier's scope,
  boundaries, invariants and design decisions.
- [README](../README.md) — installation, the entry points and carriers, and usage examples.
- The carriers: [ws](./ws.md), [http](./http.md), [mcp](./mcp.md), [acp](./acp.md),
  [webrtc](./webrtc.md) and [link](./link.md): installation, options and usage per carrier.
