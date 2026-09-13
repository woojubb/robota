# @robota-sdk/agent-transport

Browser-safe transport protocol and delivery substrate for the Robota SDK. Node-only admission and
handoff integrity helpers are available through `./node`; browser decoders are available through
`./client`. TUI (Ink/React) rendering ships as the standalone
`@robota-sdk/agent-transport-tui` package, keeping this core React-free.

## Usage

```typescript
// Shared session-message handling
import { createSessionMessageHandler } from '@robota-sdk/agent-transport';

// Browser-side runtime decoding
import { decodeServerMessage } from '@robota-sdk/agent-transport/client';

// Node-only admission helpers
import { resolveAdmission } from '@robota-sdk/agent-transport/node';

// TUI presentation host (session-owning, not ITransportAdapter)
import { renderApp } from '@robota-sdk/agent-transport-tui';

// WebSocket transport
import { WsTransport } from '@robota-sdk/agent-transport-ws';
```

## Documents

- [SPEC.md](./SPEC.md) — package contract, sub-path layout, and ownership boundaries.
