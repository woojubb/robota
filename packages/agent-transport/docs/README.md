# @robota-sdk/agent-transport

Consolidated transport package for the Robota SDK. Protocol adapters are available via
sub-path exports. TUI (Ink/React) rendering lives in the `./tui` sub-path to isolate React
dependencies from pure-TS consumers.

## Usage

```typescript
// Headless (non-interactive) transport
import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';

// TUI transport
import { TuiTransport } from '@robota-sdk/agent-transport-tui';

// WebSocket transport
import { WsTransport } from '@robota-sdk/agent-transport-ws';
```

## Documents

- [SPEC.md](./SPEC.md) — package contract, sub-path layout, and ownership boundaries.
