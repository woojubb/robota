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

## Channel Lifecycle & Teardown

`TuiInteractionChannel` owns the interactive session and its render state; its teardown contract is
authoritative for how the TUI releases resources on session switch and process exit.

- **`start()`** wires the session event listeners (13 `session.on(...)` bindings) and begins the
  init poller. It is idempotent (a `sessionStarted` guard).
- **`stop()`** is the full, idempotent channel teardown (a `stopped` guard makes repeat calls
  no-ops). It **unwires every session listener** it registered (each binding is retained and removed
  with `session.off(...)` — no handler may stay bound to a discarded session), drains the permission
  and user-action queues (see below), stops the init poller, disposes the `TuiStateManager`, stops
  transports, and — unless the channel was already gracefully shut down — **shuts the underlying
  session down** (bounded by `SHUTDOWN_TIMEOUT_MS`) so a discarded or switched-away channel releases
  its background tasks, subagent child processes, and timers. A channel that leaves listeners bound
  or its session running after `stop()` is a defect.
- **`shutdown({ reason, timeoutMs? })`** is the graceful process-exit path (first Ctrl+C, `/exit`,
  signal). It marks `isShuttingDown`, drains both queues, renders `Shutting down...`, then awaits the
  session shutdown **bounded by a timeout** (`SHUTDOWN_TIMEOUT_MS`, overridable) so a wedged subsystem
  can never block process exit. It is idempotent (`isShuttingDown` guard).
- **Session switch policy.** The old channel is `stop()`-ed _before_ the new channel becomes active,
  so it can never receive events addressed to the new session and its session is shut down as part of
  that teardown. This is the single owner of old-session shutdown on switch.

### Queue drain on abort / shutdown

The channel serves two independent request queues. Both must be drained on `abort()`, `cancelQueue()`,
`shutdown()`, and `stop()` so no promise dangles:

- `cancelAllUserActions()` — resolves every queued/in-flight CMD-004 ask as `{ type: 'cancelled' }`.
- `cancelAllPermissions()` — resolves every queued/in-flight permission request as `false` (deny):
  aborting or shutting down must never leave a tool's permission promise unresolved (the tool would
  hang) nor grant it. The two drains are symmetric; a permission queue with no cancel path is a defect.

### Stall-hint suppression during tool execution (ERR-001 G3)

`TuiStateManager` arms a dead-air hint (`isStalled`) after `STALL_HINT_MS` of no provider activity
while thinking. A running tool is legitimate activity, not a stalled connection, so the hint is
**suppressed while any tool is running**: `onToolStart` clears the stall timer, and it is re-armed
only when the last running tool ends and the turn is still thinking. `TuiStateManager.dispose()`
releases the stall timer and the streaming-debounce timer and nulls `onChange`.

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
