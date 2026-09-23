# @robota-sdk/agent-transport-ws

WebSocket carrier for the Robota SDK. The transport-neutral wire protocol, message types, and shared
session handler belong to `@robota-sdk/agent-transport`; this package adapts them to WebSocket
connections without pulling React, Ink, or Hono.

```typescript
import { WsTransport } from '@robota-sdk/agent-transport-ws';
import { createSessionMessageHandler } from '@robota-sdk/agent-transport';
import type { TServerMessage, TClientMessage } from '@robota-sdk/agent-transport';
```

See [docs/SPEC.md](./docs/SPEC.md) for the full contract.

The carrier forwards plan, context-refresh, and branch events using the shared serializable event types.
If a socket is not open or `send` fails asynchronously, the carrier runs one idempotent connection cleanup
path and reports the delivery failure without throwing back through the committed session operation.

Hosts may inject personal, stored-session, and current-session usage reporters when constructing the
transport. Each admitted connection receives those capabilities through the shared protocol handler;
the WebSocket transport itself never reads session stores or performs analytics.
