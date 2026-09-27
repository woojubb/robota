# @robota-sdk/agent-ui-terminal

React + Ink terminal UI for the Robota SDK — the interactive renderer the `robota` CLI uses. It owns its
interactive session through `TuiInteractionChannel`; it is not a borrowed-session `ITransportAdapter`.

## Installation

```bash
npm install @robota-sdk/agent-ui-terminal
```

The package is ESM-only: use `import` or `import()`. It has no `require()` entry, because Ink loads
`yoga-layout`, which starts with a top-level `await` that `require()` cannot run.

## Entry points

```typescript
import { renderApp, createDefaultTuiCliAdapter } from '@robota-sdk/agent-ui-terminal';
```

- `renderApp(options)` — render the full TUI on a session this process builds and owns.
- `renderAttachedApp(options)` — render the full TUI as a thin client of a session another host (a
  workspace daemon) runs. Leaving only detaches; the session keeps running.
- `renderSupervisedSessionView(options)` — the list view of supervised sessions behind
  `robota session view`.
- `TuiInteractionChannel` — the session-owning interaction channel `renderApp` builds.
- `createDefaultTuiCliAdapter(options)` — the default settings/plugin seam the renderer reads through.
- Theme and key-binding helpers (`createThemeRegistry`, `createThemeCataloguePort`,
  `createNodeKeybindingsSource`) for the host that composes `/theme` and `/keybindings`.

## Session behavior

The channel consumes the exhaustive shared session-event map directly. Plan, context-refresh, and branch
events render as bounded operational notices outside canonical conversation history. A TUI projection
failure is reported through `onSessionEventDeliveryError` (or rendered as a visible fallback notice) and
does not reverse the already-committed session operation.

`IRenderOptions.projectAccess` carries the host's trusted-or-restricted project decision through
`renderApp` into `TuiInteractionChannel`. `cwd` alone never enables project discovery; omission is
Restricted. Checkpoint mutation is separately opt-in through `createEditCheckpointStore`, which
builds each session its own store.

The status bar projects the session's active model-effort level next to the provider/model when the
session exposes it. This is a read-only view of session state and remains separate from thinking
display settings.

## Documentation

See [docs/SPEC.md](./docs/SPEC.md) for the full contract, including the attached-client rules, theme
and screen-reader behavior, and teardown. PTY test helpers live in `src/__tests__/pty/`; they are internal and not exported.
