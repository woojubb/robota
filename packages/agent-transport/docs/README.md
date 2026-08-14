# @robota-sdk/agent-transport

Consolidated transport package for the Robota SDK. Protocol adapters are available via
sub-path exports. TUI (Ink/React) rendering ships as the standalone
`@robota-sdk/agent-transport-tui` package, keeping this core React-free.

## Usage

```typescript
// Headless (non-interactive) transport
import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';

// TUI presentation host (session-owning, not ITransportAdapter)
import { renderApp } from '@robota-sdk/agent-transport-tui';

// WebSocket transport
import { WsTransport } from '@robota-sdk/agent-transport-ws';
```

## Documents

- [SPEC.md](./SPEC.md) — package contract, sub-path layout, and ownership boundaries.
