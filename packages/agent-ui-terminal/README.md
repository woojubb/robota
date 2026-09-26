# @robota-sdk/agent-ui-terminal

React + Ink terminal UI presentation for the Robota SDK. It owns its interactive session through
`TuiInteractionChannel`; it is not a borrowed-session `ITransportAdapter`.

The channel consumes the exhaustive shared session-event map directly. Plan, context-refresh, and branch
events render as bounded operational notices outside canonical conversation history. A TUI projection
failure is reported through `onSessionEventDeliveryError` (or rendered as a visible fallback notice) and
does not reverse the already-committed session operation.

`IRenderOptions.projectAccess` carries the host's trusted-or-restricted project decision through
`renderApp` into `TuiInteractionChannel`. `cwd` alone never enables project discovery; omission is
Restricted. Checkpoint mutation is separately opt-in through `editCheckpointStore`.

The status bar projects the session's active model-effort level next to the provider/model when the
session exposes it. This is a read-only view of session state and remains separate from thinking
display settings.

```typescript
import { renderApp, createDefaultTuiCliAdapter } from '@robota-sdk/agent-ui-terminal';
```

The package is ESM-only: use `import` or `import()`. It has no `require()` entry, because Ink loads
`yoga-layout`, which starts with a top-level `await` that `require()` cannot run.

See [docs/SPEC.md](./docs/SPEC.md) for the full contract.

PTY test support is internal to `src/__tests__/pty/`; the former private `agent-testing`
workspace package has been removed. These helpers are not public exports. See the
[test strategy](./docs/SPEC.md) for runtime verification and isolation constraints.
