# @robota-sdk/agent-transport-tui

React + Ink terminal UI presentation for the Robota SDK. It owns its interactive session through
`TuiInteractionChannel`; it is not a borrowed-session `ITransportAdapter`.

```typescript
import { renderApp, createDefaultTuiCliAdapter } from '@robota-sdk/agent-transport-tui';
```

See [docs/SPEC.md](./docs/SPEC.md) for the full contract.
