# @robota-sdk/agent-transport-tui

React + Ink terminal UI transport for the Robota SDK. Split out of the consolidated transport
package so React/Ink/node-pty stay isolated from non-TUI consumers.

```typescript
import {
  renderApp,
  createDefaultTuiCliAdapter,
  TuiTransport,
} from '@robota-sdk/agent-transport-tui';
```

See [docs/SPEC.md](./docs/SPEC.md) for the full contract.
