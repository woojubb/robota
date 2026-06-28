# @robota-sdk/agent-transport — Package Specification

## 1. Scope

Core transport package for the Robota SDK. After DQ-AUDIT-005 the consolidated transport package was
split by concern; this package owns only the **dependency-free core**:

- Headless transport (`/headless`): non-interactive print/JSON/stream-json runner — `HeadlessInteractionChannel`, `createHeadlessRunner`, `PrintTerminal`, `promptInput`, `createHeadlessTransport`.
- Transport registry (root): `TransportRegistry` — settings-backed enable/disable of `IConfigurableTransport` instances.
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
  transport-registry.ts         ← TransportRegistry (generic, settings-backed)
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

`createProgrammaticAgent({ provider, cwd, commandModules?, sessionStore?, permissionMode? })` wires a
`ProgrammaticInteractionChannel` to a real `InteractiveSession` via `createInteractiveRuntime`.
`send(text)` pushes a user submission and awaits the whole turn; the channel records the framework's
one-way `InteractionEvent` stream into `events`, which the driver exposes as `assistantReplies()`,
`lastAssistantText()`, `toolCalls()`, and `errors()`. `queueAction(response)` pre-answers a
disambiguation `requestAction` (an empty queue resolves `{ type: 'cancelled' }`, so a run never
deadlocks). This is the in-process form of "drive the agent at will" (TEST-008).

### Headless lifecycle

`HeadlessInteractionChannel` constructs the `InteractiveSession`, runs a single prompt via
`createHeadlessRunner`, and exposes `getExitCode()`. Output format (`text` / `json` / `stream-json`)
is selected by the runner options.

## 4. Type Ownership

| Type                                 | File                                          | Description                                  |
| ------------------------------------ | --------------------------------------------- | -------------------------------------------- |
| `IHeadlessInteractionChannelOptions` | `src/headless/HeadlessInteractionChannel.ts`  | Constructor options for the headless channel |
| `IHeadlessRunnerOptions`             | `src/headless/headless-runner.ts`             | Options for `createHeadlessRunner`           |
| `TOutputFormat`                      | `src/headless/headless-runner.ts`             | `'text' \| 'json' \| 'stream-json'`          |
| `IHeadlessTransportOptions`          | `src/headless/headless-transport.ts`          | Options for `createHeadlessTransport`        |
| `ICreateProgrammaticAgentOptions`    | `src/programmatic/createProgrammaticAgent.ts` | Options for `createProgrammaticAgent`        |
| `IProgrammaticAgent`                 | `src/programmatic/createProgrammaticAgent.ts` | The in-process driver surface                |

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
| `createHeadlessTransport`            | function   | Returns `ITransportAdapter & { getExitCode(): number }` wrapping `createHeadlessRunner`                  |
| `IHeadlessTransportOptions`          | interface  | Options for `createHeadlessTransport`                                                                    |

### `/programmatic`

| Export                            | Kind      | Description                                                                                       |
| --------------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| `ProgrammaticInteractionChannel`  | class     | In-process `IInteractionChannel` adapter: buffers `InteractionEvent`s, FIFO action-response queue |
| `createProgrammaticAgent`         | function  | Driver over `createInteractiveRuntime`: `start`/`send`/`stop` + structured accessors              |
| `ICreateProgrammaticAgentOptions` | interface | `{ provider, cwd, commandModules?, sessionStore?, permissionMode? }`                              |
| `IProgrammaticAgent`              | interface | Driver surface: `events`, `send`, `assistantReplies`, `lastAssistantText`, `toolCalls`, `errors`  |

### `/testing`

| Export                                | Kind     | Description                                                      |
| ------------------------------------- | -------- | ---------------------------------------------------------------- |
| `createScriptedProvider`              | function | Deterministic `IAIProvider` for transport/CLI tests (no network) |
| `IScriptedProvider` / `TScriptedTurn` | types    | Scripted-provider contract + turn shape                          |

### Root (`@robota-sdk/agent-transport`)

| Export                                          | Kind  | Description                                                          |
| ----------------------------------------------- | ----- | -------------------------------------------------------------------- |
| `TransportRegistry`                             | class | Settings-backed enable/disable registry of `IConfigurableTransport`s |
| (plus `/headless` + `/programmatic` re-exports) |       | The root barrel also re-exports the headless + programmatic surfaces |

## 6. Extension Points

Register any `IConfigurableTransport` (from the per-concern transport packages) into a
`TransportRegistry`; enablement and options are persisted under `transports` in settings.json. The
composition root decides which concrete transports to register.

## 7. Error Taxonomy

Headless runner surfaces provider/runtime errors with a non-zero exit code (`getExitCode()`).
Registry settings I/O errors propagate from the `agent-framework` settings helpers.

## 8. Test Strategy

Headless runner/channel unit + integration tests and scripted-provider tests under `src/**/__tests__`.

## 9. Class Contract Registry

### `HeadlessInteractionChannel`

Constructs the session, runs one prompt, exposes `getExitCode()`. Print/JSON/stream-json framing is
delegated to the runner. Does not own interactive UI.

### `TransportRegistry`

`register(transport)`, `getAll()`, `getEnabled()`, `setEnabled(name, enabled)`,
`setOptions(name, options)`, `startAll(session)`, `stopAll()`. Reads/writes the `transports` block of
a settings file at the path supplied to the constructor. Holds no concrete-transport import.
