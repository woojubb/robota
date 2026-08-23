# @robota-sdk/agent-transport — Package Specification

## Transport Admission (SEC-008)

transport-admission: none — this package is the transport REGISTRY plus a headless in-process adapter and testing fixtures. Nothing here accepts a peer over a wire, so there is no admission decision to make; the transports it registers each make their own.

## 1. Scope

Core transport package for the Robota SDK. After DQ-AUDIT-005 the consolidated transport package was
split by concern; this package owns only the **dependency-free core**:

- Headless transport (`/headless`): non-interactive print/JSON/stream-json runner — `HeadlessInteractionChannel`, `createHeadlessRunner`, `PrintTerminal`, `promptInput`, `createHeadlessTransport`.
- Transport registry (root): `TransportRegistry` — base-adapter lifecycle plus an optional,
  configurable-only settings projection on the same entry.
- Programmatic driver (`/programmatic`): an in-process `IInteractionChannel` adapter
  (`ProgrammaticInteractionChannel`) + `createProgrammaticAgent` driver — drive the real agent
  structurally (`start`/`send`/`stop`, read assistant replies / tool calls / errors as data) with no
  terminal, no PTY, no scraping.
- Testing fixtures (`/testing`): `createScriptedProvider` deterministic provider for transport/CLI tests.

The per-concern transport implementations live in their own packages: `@robota-sdk/agent-transport-tui`
(React/Ink), `-ws` (WebSocket), `-http` (Hono), `-mcp` (MCP). This package has **zero external runtime
dependencies** — pure TypeScript over Node stdlib + `@robota-sdk/*` contracts.

## 2. Boundaries

| Rule                           | Detail                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Zero external runtime deps     | Only `@robota-sdk/agent-core`, `agent-framework`, `agent-interface-transport`; no React/Ink/ws/hono/mcp                                                |
| No concrete-transport edge     | `TransportRegistry` is generic; it does not import any concrete transport. The default registration of `WsTransport` lives in the CLI composition root |
| Registry settings shape        | `{ "transports": { "<name>": { "enabled": bool, "options": {...} } } }` under `transports` in settings.json                                            |
| `IInteractionChannel` fidelity | `HeadlessInteractionChannel` does not implement `IInteractionChannel` directly if that would lose session events outside the `InteractionEvent` union  |

## 3. Architecture Overview

```
agent-transport/src
  index.ts                      ← barrel: headless + TransportRegistry
  transport-registry.ts         ← TransportRegistry (base lifecycle + optional settings capability)
  headless/
    HeadlessInteractionChannel.ts ← session creation + runner for print mode
    headless-runner.ts          ← createHeadlessRunner (text/json/stream-json)
    headless-transport.ts       ← createHeadlessTransport (ITransportAdapter wrapper)
    headless-stream-json.ts     ← stream-json framing
    print-terminal.ts           ← PrintTerminal, promptInput
  testing/
    scripted-provider.ts        ← createScriptedProvider (test-only, via /testing subpath)
  programmatic/
    ProgrammaticInteractionChannel.ts ← in-process IInteractionChannel adapter (event buffer + action queue)
    createProgrammaticAgent.ts  ← driver over createInteractiveRuntime (start/send/stop + accessors)
```

### Programmatic driving

`createProgrammaticAgent({ provider, cwd, projectAccess?, commandModules?, sessionStore?, permissionMode? })`
wires a `ProgrammaticInteractionChannel` to a real `InteractiveSession` via
`createInteractiveRuntime`. `cwd` is provenance only: an omitted `projectAccess` produces the
framework's explicit Restricted decision, while a host-issued trusted decision is forwarded
unchanged to the session.
`send(text)` pushes a user submission and awaits the whole turn; the channel records the framework's
one-way `InteractionEvent` stream into `events`, which the driver exposes as `assistantReplies()`,
`lastAssistantText()`, `toolCalls()`, and `errors()`. `queueUserAction(response)` pre-answers the next
CMD-004 `askUser` a command may issue (an empty queue resolves `{ type: 'cancelled' }`, so a run never
deadlocks). This is the in-process form of "drive the agent at will" (TEST-008).

### Host-action parity (CMD-004 Stage D)

A command's HOST ACTIONS (`language-change`, `settings-reset`, `session-exit`/`-restart`,
`session-rename`, …) are executed by the SESSION via the injected `ICommandHostAdapters` — the LSP
`workspace/executeCommand` model — so they work with **zero attached surfaces**: a headless or
programmatic embedding gets the same command semantics as the TUI/GUI. An embedder that wires
`commandHostAdapters` (settings/process/…) into its `InteractiveSession` gets full host execution;
an embedding with no adapter for a requested action gets an EXPLICIT failure in the command result
naming the missing capability (`Cannot apply '<action>': … not available in this environment.`) —
never a silent skip (no-fallback). `createProgrammaticAgent` wires no adapters today, so host
actions surface that explicit failure through the `command-result` event as data. UI intents
(`ui_intent`) are fire-and-forget presentation requests: with zero listeners attached they are a
defined no-op (there is no surface to render them; the host action half is unaffected). Proven by
`src/__tests__/headless-host-action-parity.test.ts` and the multi-surface exit/restart policy e2e
`src/__tests__/ws-multi-surface-exit-policy.test.ts` (TC-09: a remote `/exit` or restart acts on
the SHARED host serving all surfaces — local == remote, REMOTE-006).

### Headless lifecycle

`HeadlessInteractionChannel` constructs the `InteractiveSession`, runs a single prompt via
`createHeadlessRunner`, and exposes `getExitCode()`. Output format (`text` / `json` / `stream-json`)
is selected by the runner options.

## 4. Type Ownership

| Type                                 | File                                          | Description                                                                         |
| ------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `IHeadlessInteractionChannelOptions` | `src/headless/HeadlessInteractionChannel.ts`  | Constructor options for the headless channel                                        |
| `IHeadlessRunnerOptions`             | `src/headless/headless-runner.ts`             | Options for `createHeadlessRunner`                                                  |
| `TOutputFormat`                      | `src/headless/headless-runner.ts`             | `'text' \| 'json' \| 'stream-json'`                                                 |
| `IHeadlessTransportOptions`          | `src/headless/headless-transport.ts`          | Options for `createHeadlessTransport`                                               |
| `IHeadlessSession`                   | `src/headless/headless-session.ts`            | Exact submission/events/commands/goal/identity roles consumed by headless execution |
| `ICreateProgrammaticAgentOptions`    | `src/programmatic/createProgrammaticAgent.ts` | Options for `createProgrammaticAgent`                                               |

The in-process driver surface itself is `IAgentDriver`, owned by
`@robota-sdk/agent-interface-transport` — this package defines no driver type of its own.

## 5. Public API Surface

### `/headless`

| Export                               | Kind       | Description                                                                                              |
| ------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------- |
| `HeadlessInteractionChannel`         | class      | Owns session creation + runner for non-interactive (print) mode; call `run(prompt)` then `getExitCode()` |
| `IHeadlessInteractionChannelOptions` | interface  | Constructor options for `HeadlessInteractionChannel`                                                     |
| `PrintTerminal`                      | class      | Utility for formatted terminal output in headless mode                                                   |
| `promptInput`                        | function   | Reads a single line from stdin                                                                           |
| `createHeadlessRunner`               | function   | Creates a runner with `run(prompt): Promise<number>`; supports text/json/stream-json modes               |
| `IHeadlessRunnerOptions`             | interface  | Options for `createHeadlessRunner`                                                                       |
| `TOutputFormat`                      | type alias | `'text' \| 'json' \| 'stream-json'`                                                                      |
| `createHeadlessTransport`            | function   | Returns legacy-compatible `IHeadlessTransport` wrapping `createHeadlessRunner`                           |
| `IHeadlessTransportOptions`          | interface  | Options for `createHeadlessTransport`                                                                    |
| `IHeadlessSession`                   | interface  | Narrow session-role aggregate accepted by headless runner and transport                                  |
| `IHeadlessTransport`                 | interface  | Legacy `ITransportAdapter<IInteractiveSession>` declaration with `attach(IHeadlessSession)` overload     |

### `/programmatic`

| Export                            | Kind      | Description                                                                                                  |
| --------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `ProgrammaticInteractionChannel`  | class     | In-process `IInteractionChannel` adapter: buffers `InteractionEvent`s, FIFO action-response queue            |
| `createProgrammaticAgent`         | function  | Driver over `createInteractiveRuntime`: `start`/`send`/`stop` + structured accessors                         |
| `ICreateProgrammaticAgentOptions` | interface | `{ provider, cwd, projectAccess?, commandModules?, sessionStore?, permissionMode? }`; omission is Restricted |

The driver returned by `createProgrammaticAgent` is typed as `IAgentDriver` (owned by
`@robota-sdk/agent-interface-transport`, not re-exported here): `events`, `start`, `send`,
`queueUserAction`, `assistantReplies`, `lastAssistantText`, `toolCalls`, `errors`, `stop`.

### `/testing`

| Export                                | Kind     | Description                                                      |
| ------------------------------------- | -------- | ---------------------------------------------------------------- |
| `createScriptedProvider`              | function | Deterministic `IAIProvider` for transport/CLI tests (no network) |
| `IScriptedProvider` / `TScriptedTurn` | types    | Scripted-provider contract + turn shape                          |

### Root (`@robota-sdk/agent-transport`)

| Export                                          | Kind  | Description                                                                |
| ----------------------------------------------- | ----- | -------------------------------------------------------------------------- |
| `TransportRegistry`                             | class | Base adapter lifecycle registry with configurable-only settings projection |
| (plus `/headless` + `/programmatic` re-exports) |       | The root barrel also re-exports the headless + programmatic surfaces       |

## 6. Extension Points

Register any `ITransportAdapter` into a `TransportRegistry`. A service or runner that also satisfies
the orthogonal `ITransportSettingsCapability` appears as `TConfigurableTransport` in `getAll()` and
persists enablement/options under `transports` in settings.json; a base-only adapter is
lifecycle-enabled and absent from settings. The legacy `IConfigurableTransport` name remains the
source-compatible configurable-service shape. Duplicate names reject. Unknown or non-configurable
settings mutations reject `TransportConfigurationError`.

## 7. Error Taxonomy

Headless runner surfaces provider/runtime errors as typed failed outcomes with a non-zero exit code;
`getExitCode()` remains the package-specific readback.
Registry settings I/O errors propagate from the `agent-framework` settings helpers.

`run(prompt)` resolves the exit code only AFTER the underlying `session.submit()` operation has fully
settled — the terminal `complete`/`interrupted`/`error` event fires from inside the turn, before the
turn's awaited `finally` runs session persistence / checkpoint finalize, so the runner awaits the
operation (not just the event) so all trailing writes under cwd `.robota/` have drained before the
process may exit. It writes exactly one terminal record per run (CI-001).

## 8. Test Strategy

Headless runner/channel unit + integration tests and scripted-provider tests under `src/**/__tests__`.
The programmatic integration suite proves that an explicitly trusted project decision reaches the
real session and enables its authority-bound context source. The `public-project-authority` AST guard
also requires every published high-level construction interface that accepts `cwd` to carry
`TWorkspaceProjectAccess`.
The headless public adapter invokes the shared interface-transport lifecycle conformance helper; the
harness roster scan proves it is one of exactly six registered public subjects.

## 9. Class Contract Registry

### `HeadlessInteractionChannel`

Constructs the session, runs one prompt, exposes `getExitCode()`. Print/JSON/stream-json framing is
delegated to the runner. Does not own interactive UI.

### `TransportRegistry`

`register(transport)`, `getAll()`, `getEnabled()`, `setEnabled(name, enabled)`,
`setOptions(name, options)`, `startAll(session)`, `waitForCompletion()`, `waitForFailure()`,
`stopAll()`. Reads/writes the
`transports` block of a settings file at the path supplied to the constructor. Holds no
concrete-transport import.

**Runner ownership (ARCH-011).** `startAll` awaits each adapter's readiness-returning `start()`, then
immediately owns every runner's separate completion promise. A startup generation is sealed only
after every enabled subject is registered, so a synchronously successful first runner cannot make a
later runner disappear. `waitForCompletion()` returns one named record per runner in registration
order; pending runners become registry-owned `abandoned:stopped` or
`abandoned:startup-rollback`. `waitForFailure()` returns only the first real failed runner immediately
and returns `undefined` for no runners, all success, or normal stop abandonment. A rejected runner
promise rejects both
routes as `TransportLifecycleError`; it is observed immediately and cannot become an unhandled
rejection.

The registry serializes idle/starting/active/stopping transitions. Active restart rejects before
mutation. Startup failure rolls back from the failing adapter through prior adapters in reverse order
and rejects `TransportStartupError` with the primary non-enumerable cause plus ordered safe rollback
details. `stopAll()` terminalizes pending aggregate slots rather than waiting on terminal work. Late
settlement is ignored, and a later `startAll` owns a distinct generation. Transport stops remain
best-effort and their errors are collected in `IDestroyResult`.
