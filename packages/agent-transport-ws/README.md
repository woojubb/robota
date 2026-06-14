# @robota-sdk/agent-transport-ws

WebSocket transport and wire protocol for the Robota SDK. Consumers that only need the WS message
types (e.g. browser monitors) depend on this package without pulling React/Ink/Hono.

```typescript
import { WsTransport, createWsHandler } from '@robota-sdk/agent-transport-ws';
import type { TServerMessage, TClientMessage } from '@robota-sdk/agent-transport-ws';
```

See [docs/SPEC.md](./docs/SPEC.md) for the full contract.
