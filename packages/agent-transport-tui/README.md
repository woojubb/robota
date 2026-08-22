# @robota-sdk/agent-transport-tui

React + Ink terminal UI presentation for the Robota SDK. It owns its interactive session through
`TuiInteractionChannel`; it is not a borrowed-session `ITransportAdapter`.

The channel consumes the exhaustive shared session-event map directly. Plan, context-refresh, and branch
events render as bounded operational notices outside canonical conversation history. A TUI projection
failure is reported through `onSessionEventDeliveryError` (or rendered as a visible fallback notice) and
does not reverse the already-committed session operation.

`IRenderOptions.projectAccess` carries the host's trusted-or-restricted project decision through
`renderApp` into `TuiInteractionChannel`. `cwd` alone never enables project discovery; omission is
Restricted. Checkpoint mutation is separately opt-in through `editCheckpointStore`.

```typescript
import { renderApp, createDefaultTuiCliAdapter } from '@robota-sdk/agent-transport-tui';
```

See [docs/SPEC.md](./docs/SPEC.md) for the full contract.
