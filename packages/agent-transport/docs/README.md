# @robota-sdk/agent-transport

The transport-neutral protocol layer shared by every agent runtime transport: the wire messages a client and
a host exchange, the session bridge that applies them to a live session, and the delivery helpers
(backpressure, resumable delivery, channel framing, handoff chunking) a carrier builds on. It owns no
socket, listener or UI.

The root and `./client` entry points run in the browser; Node-only access-token verification, the
bearer resource-server gate, file transfer, the stdio carrier bridge and handoff integrity helpers
are under `./node`. The carriers themselves
are separate packages: `@robota-sdk/agent-transport-ws`, `-http`, `-mcp`, `-acp` and `-webrtc`.

```typescript
// Shared session-message handling and transport admission (browser and Node)
import { createSessionMessageHandler, resolveAdmission } from '@robota-sdk/agent-transport';

// Browser-side runtime decoding
import { decodeServerMessage } from '@robota-sdk/agent-transport/client';

// Node-only access-token verification
import { createAccessTokenVerifier } from '@robota-sdk/agent-transport/node';
```

## Documents

- [SPEC.md](./SPEC.md) — package contract, entry-point layout and ownership boundaries.
- [README](../README.md) — installation and usage examples.
