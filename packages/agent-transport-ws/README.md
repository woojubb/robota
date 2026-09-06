# @robota-sdk/agent-transport-ws

WebSocket transport and wire protocol for the Robota SDK. Consumers that only need the WS message
types (e.g. browser monitors) depend on this package without pulling React/Ink/Hono.

```typescript
import { WsTransport } from '@robota-sdk/agent-transport-ws';
import { createWsHandler } from '@robota-sdk/agent-transport-protocol';
import type { TServerMessage, TClientMessage } from '@robota-sdk/agent-transport-protocol';
```

See [docs/SPEC.md](./docs/SPEC.md) for the full contract.

The protocol forwards plan, context-refresh, and branch events using the shared serializable event types.
If a socket is not open or `send` fails asynchronously, the carrier runs one idempotent connection cleanup
path and reports the delivery failure without throwing back through the committed session operation.

Hosts may inject personal, stored-session, and current-session usage reporters when constructing the
transport. Each admitted connection receives those capabilities through the shared protocol handler;
the WebSocket transport itself never reads session stores or performs analytics.
