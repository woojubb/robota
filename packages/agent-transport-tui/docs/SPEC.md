# agent-transport-tui Specification

## Scope

Terminal UI transport for the Robota SDK — the React + Ink interactive renderer. Split out of the
former consolidated `agent-transport` package (DQ-AUDIT-005) so that React/Ink/node-pty are isolated
to this package and never enter the dependency graph of non-TUI consumers.

## Boundaries

- Owns the Ink/React rendering pipeline, the TUI interaction channel, and the default TUI CLI adapter.
- Depends on `agent-interface-tui` for interaction contracts and `agent-framework` for the
  interactive-session runtime; does **not** depend on the other transport implementation packages.
- No other transport package depends on this one (verified: zero cross-transport runtime imports).

## Architecture Overview

```
agent-transport-tui
  ├── TuiTransport            ← ITransportAdapter implementation (Ink app)
  ├── renderApp              ← mounts the Ink <App/>
  ├── TuiInteractionChannel  ← IInteractionChannel for TUI mode
  └── createDefaultTuiCliAdapter ← wires command/provider UX into the renderer
```

## Type Ownership

Owns the TUI rendering/adapter types (`IRenderOptions`, `ITuiCliAdapter`,
`IDefaultTuiCliAdapterOptions`). Re-exports the `agent-interface-tui` interaction contracts for
convenience at the transport boundary.

## Public API Surface

| Export                          | Kind     | Description                             |
| ------------------------------- | -------- | --------------------------------------- |
| `TuiTransport`                  | class    | Ink-based interactive transport adapter |
| `renderApp`                     | function | Mount the Ink application               |
| `createDefaultTuiCliAdapter`    | function | Default CLI adapter for the renderer    |
| `ITuiCliAdapter` + option types | types    | Adapter contracts                       |

## Extension Points

New TUI components/flows live under `src/`. The adapter seam (`ITuiCliAdapter`) lets the CLI inject
command/provider UX without the transport knowing CLI specifics.

## Error Taxonomy

Rendering/runtime errors surface through the interactive-session event stream; this package adds no
new error classes.

## Test Strategy

Component/flow unit tests (ink-testing-library) under `src/__tests__`; a real-terminal PTY suite
(`*.ptytest.ts`, `vitest.pty.config.ts`) runs against the built CLI via `pnpm test:pty`.

## Dependencies

- `@robota-sdk/agent-interface-tui`, `@robota-sdk/agent-interface-transport` — contracts.
- `@robota-sdk/agent-framework`, `@robota-sdk/agent-core` — runtime + primitives.
- External: `react`, `ink`, `ink-*`, `marked`, `marked-terminal`, `chalk`, `string-width`.
