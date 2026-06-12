# @robota-sdk/agent-transport — Package Specification

## 1. Scope

**In scope:**

- Headless transport (`/headless`): Non-interactive text/JSON/stream-JSON output via `createHeadlessTransport` and `createHeadlessRunner`
- HTTP transport (`/http`): Hono-based REST adapter (Cloudflare Workers / Node.js / Lambda) via `createHttpTransport` and `createAgentRoutes`
- WebSocket transport (`/ws`): Framework-agnostic real-time adapter via `createWsTransport`, `createWsHandler`, and the configurable `WsTransport` class
- MCP transport (`/mcp`): Model Context Protocol server adapter via `createMcpTransport` and `createAgentMcpServer`
- TUI transport (`/tui`): Ink/React terminal UI components and `TuiTransport` adapter; includes `createDefaultTuiCliAdapter` for wiring CLI tooling
- Transport orchestration: `TransportRegistry` / `createDefaultTransportRegistry` (root export) for settings-backed enable/disable of configurable transports

**Out of scope:**

- `@robota-sdk/agent-interface-transport` — stays as an independent package (defines `ITransportAdapter` and `IConfigurableTransport` contracts); NOT merged here
- `@robota-sdk/agent-interface-tui` — independent package (defines TUI interaction contracts); command-interaction types are re-exported from there via `src/tui/command-interaction.ts`
- Custom transport implementations — consumers implement `ITransportAdapter` from `agent-interface-transport` directly

**React / Ink policy:**

React and Ink dependencies are confined to the `./tui` sub-path. Pure-TS consumers import only `/headless`, `/http`, `/ws`, or `/mcp` and receive zero React/Ink in their dependency graph.

## 2. Boundaries

| Boundary                                 | Rule                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Sub-module cross-imports                 | Sub-modules (`headless`, `http`, `ws`, `mcp`, `tui`) must never import from each other                                          |
| `agent-cli`                              | `agent-transport` must never import from `agent-cli`                                                                            |
| Cycle guard                              | `agent-transport` must never import from `agent-framework` in a way that creates a cycle with `agent-interface-transport`       |
| React confinement                        | React and Ink imports are only allowed inside `src/tui/`; all other sub-modules are pure TypeScript                             |
| `agent-interface-transport` independence | The interface package remains a separate, independent workspace package; `agent-transport` depends on it, not the reverse       |
| `agent-interface-tui` independence       | TUI interaction contracts live in `agent-interface-tui`; `src/tui/command-interaction.ts` re-exports them but does not own them |

## 3. Architecture Overview

```
                agent-core
                    ↑
       ┌────────────┴────────────┐
agent-framework         agent-transport
       ↑                        ↑
agent-interface-transport ──────┘
      (contract only, no impl)
```

`agent-framework` and `agent-transport` both import from `agent-interface-transport`. They must NEVER import each other.

### Sub-path structure

```
src/
  index.ts                   ← root re-export of all sub-paths + TransportRegistry
  transport-registry.ts      ← TransportRegistry, createDefaultTransportRegistry
  headless/
    headless-transport.ts    ← createHeadlessTransport (ITransportAdapter wrapper)
    headless-runner.ts       ← createHeadlessRunner (text/json/stream-json modes)
    headless-stream-json.ts  ← stream-json event subscription helpers
    print-terminal.ts        ← PrintTerminal utility
    cli-input.ts             ← promptInput utility
    index.ts
  http/
    routes.ts                ← createAgentRoutes (Hono router)
    http-transport.ts        ← createHttpTransport
    index.ts
  ws/
    ws-protocol.ts           ← TClientMessage, TServerMessage wire types
    ws-handler.ts            ← createWsHandler
    ws-transport.ts          ← createWsTransport
    ws-transport-configurable.ts ← WsTransport (IConfigurableTransport)
    ws-background-messages.ts
    index.ts
  mcp/
    mcp-server.ts            ← createAgentMcpServer
    mcp-transport.ts         ← createMcpTransport
    index.ts
  headless/
    HeadlessInteractionChannel.ts ← HeadlessInteractionChannel (owns session + runner)
    headless-transport.ts    ← createHeadlessTransport (legacy ITransportAdapter wrapper)
    headless-runner.ts       ← createHeadlessRunner (text/json/stream-json modes)
    headless-stream-json.ts  ← stream-json event subscription helpers
    print-terminal.ts        ← PrintTerminal utility
    cli-input.ts             ← promptInput utility
    index.ts
  tui/
    render.tsx               ← renderApp, IRenderOptions (Ink entry point)
    App.tsx                  ← App / AppInner root React component (IProps)
    TuiInteractionChannel.ts ← TuiInteractionChannel implements IInteractionChannel
    tui-transport.ts         ← TuiTransport (IConfigurableTransport, thin wrapper)
    tui-cli-adapter.ts       ← ITuiCliAdapter interface
    create-default-tui-cli-adapter.ts ← createDefaultTuiCliAdapter
    tui-state-manager.ts     ← TuiStateManager (internal)
    tui-cli-adapter-context.tsx ← React context for ITuiCliAdapter
    types.ts                 ← TPermissionResult, IPermissionRequest
    command-interaction.ts   ← re-exports from @robota-sdk/agent-interface-tui
    hooks/
      useTuiChannel.ts       ← useTuiChannel (React → TuiInteractionChannel bridge)
      usePermissionQueue.ts
      useSlashRouting.ts
      useSideEffects.ts
      usePluginCallbacks.ts
      useStatusLineSettings.ts
    interactions/
      CommandPicker.tsx      ← Ink picker dialog component
      CommandConfirm.tsx     ← Ink confirm dialog component
    index.ts
```

### TUI lifecycle

`renderApp()` creates a `TuiInteractionChannel` (which owns `InteractiveSession`, `CommandRegistry`, and `TuiStateManager` creation) and then mounts the Ink `App` component. `App` subscribes to channel state via the `useTuiChannel` hook, which calls `channel.onChange` on each state change. User input is forwarded to `channel.handleInput()`; slash commands that need disambiguation call `channel.requestAction()`, which queues a pick/confirm dialog rendered by `App` and resolved via `channel.resolveAction()`.

### TUI session-init polling

`TuiInteractionChannel.start()` polls session readiness via
`flows/session-init-poller.ts` (`createSessionInitPoller`): every 200ms it runs the readiness
check; errors matching /not initialized/i are benign and retried until a 15s timeout, any other
error fails immediately. On failure the channel sets the state-manager error flag and appends a
`category: 'event'` / `type: 'session-init-error'` history entry so the user sees a message
instead of an eternal spinner. The channel also subscribes to the session `memory_event` and
re-syncs history so memory notices render in the transcript.

### Headless lifecycle

`HeadlessInteractionChannel` owns session creation for non-interactive (print) mode. Callers construct `new HeadlessInteractionChannel(options)` and call `await channel.run(prompt)`. The channel creates `InteractiveSession`, runs `createHeadlessRunner`, and awaits completion. `channel.getExitCode()` returns `0` or `1`. The legacy `createHeadlessTransport` wrapper is retained for internal use by `headless-runner`.

Provider failures during a run reach the runner as the session `error` event (the execution layer marks the result failed and `robotaRun` throws it). The runner's error path exits `1` in every output format: text writes the error message to stderr; json and stream-json emit a `{ type: "result", subtype: "error", error_code }` envelope on stdout (`error_code` from `resolveErrorCode`: `config_error` | `tool_error` | `api_error`). A provider failure must never produce exit `0`.

## 4. Type Ownership

| Type                                 | Location                                                   | Purpose                                                                  |
| ------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `IRenderOptions`                     | `src/tui/render.tsx`                                       | Options passed to `renderApp()`; includes all session + TUI options      |
| `ITuiInteractionChannelOptions`      | `src/tui/TuiInteractionChannel.ts`                         | Constructor options for `TuiInteractionChannel`                          |
| `IProps`                             | `src/tui/App.tsx` (internal)                               | React props for the root `App` / `AppInner` components                   |
| `IHeadlessInteractionChannelOptions` | `src/headless/HeadlessInteractionChannel.ts`               | Constructor options for `HeadlessInteractionChannel`                     |
| `ITuiCliAdapter`                     | `src/tui/tui-cli-adapter.ts`                               | Port interface for CLI-level operations (settings, git, model switching) |
| `IDefaultTuiCliAdapterOptions`       | `src/tui/create-default-tui-cli-adapter.ts`                | Options for `createDefaultTuiCliAdapter`                                 |
| `TPermissionResult`                  | `src/tui/types.ts`                                         | Union: `boolean \| 'allow-session' \| 'allow-project'`                   |
| `IPermissionRequest`                 | `src/tui/types.ts`                                         | Pending permission request passed to `PermissionPrompt`                  |
| `IHeadlessTransportOptions`          | `src/headless/headless-transport.ts`                       | Options for `createHeadlessTransport` (`outputFormat`, `prompt`)         |
| `IHeadlessRunnerOptions`             | `src/headless/headless-runner.ts`                          | Options for `createHeadlessRunner` (`session`, `outputFormat`)           |
| `TOutputFormat`                      | `src/headless/headless-runner.ts`                          | `'text' \| 'json' \| 'stream-json'`                                      |
| `IAgentRoutesOptions`                | `src/http/routes.ts`                                       | Options for `createAgentRoutes`                                          |
| `TSessionFactory`                    | `src/http/routes.ts`                                       | Factory type for creating sessions in HTTP handlers                      |
| `IHttpTransportOptions`              | `src/http/http-transport.ts`                               | Options for `createHttpTransport`                                        |
| `TClientMessage`                     | `src/ws/ws-protocol.ts`                                    | WebSocket client → server message wire type                              |
| `TServerMessage`                     | `src/ws/ws-protocol.ts`                                    | WebSocket server → client message wire type                              |
| `IWsHandlerOptions`                  | `src/ws/ws-handler.ts`                                     | Options for `createWsHandler`                                            |
| `IWsTransportOptions`                | `src/ws/ws-transport.ts`                                   | Options for `createWsTransport`                                          |
| `IWsTransportConfig`                 | `src/ws/ws-transport-configurable.ts`                      | Config for the `WsTransport` configurable class                          |
| `IAgentMcpOptions`                   | `src/mcp/mcp-server.ts`                                    | Options for `createAgentMcpServer`                                       |
| `IMcpTransportOptions`               | `src/mcp/mcp-transport.ts`                                 | Options for `createMcpTransport`                                         |
| `TOnMissingArgsAction`               | re-exported from `@robota-sdk/agent-interface-tui`         | Action when command args are missing                                     |
| `ITuiPickerItem`                     | re-exported from `@robota-sdk/agent-interface-tui`         | Item shape for picker interactions                                       |
| `ITuiCommandInteraction`             | re-exported from `@robota-sdk/agent-interface-tui`         | Base command interaction type                                            |
| `ITuiPickerInteraction`              | re-exported from `@robota-sdk/agent-interface-tui`         | Picker interaction variant                                               |
| `ITuiConfirmInteraction`             | re-exported from `@robota-sdk/agent-interface-tui`         | Confirm interaction variant                                              |
| `TAnyTuiCommandInteraction`          | re-exported from `@robota-sdk/agent-interface-tui`         | Union of all TUI interaction types                                       |
| `IExecutionWorkspaceSnapshot`        | re-exported from `@robota-sdk/agent-framework` (via `/ws`) | Snapshot of agent execution workspace                                    |
| `IExecutionWorkspaceEntry`           | re-exported from `@robota-sdk/agent-framework` (via `/ws`) | Single entry in the execution workspace                                  |
| `TExecutionWorkspaceStatus`          | re-exported from `@robota-sdk/agent-framework` (via `/ws`) | Status enum for workspace entries                                        |
| `TExecutionAttention`                | re-exported from `@robota-sdk/agent-framework` (via `/ws`) | Attention level for workspace entries                                    |

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
| `createHeadlessTransport`            | function   | Legacy: returns `ITransportAdapter & { getExitCode(): number }` wrapping `createHeadlessRunner`          |
| `IHeadlessTransportOptions`          | interface  | Options for `createHeadlessTransport`                                                                    |

### `/http`

| Export                  | Kind       | Description                                     |
| ----------------------- | ---------- | ----------------------------------------------- |
| `createAgentRoutes`     | function   | Creates a Hono router with REST agent endpoints |
| `IAgentRoutesOptions`   | interface  | Options for `createAgentRoutes`                 |
| `TSessionFactory`       | type alias | Session factory type used by HTTP handlers      |
| `createHttpTransport`   | function   | Creates an HTTP transport adapter               |
| `IHttpTransportOptions` | interface  | Options for `createHttpTransport`               |

### `/ws`

| Export                        | Kind       | Description                                                 |
| ----------------------------- | ---------- | ----------------------------------------------------------- |
| `createWsHandler`             | function   | Creates a raw WebSocket handler (framework-agnostic)        |
| `IWsHandlerOptions`           | interface  | Options for `createWsHandler`                               |
| `TClientMessage`              | type alias | WebSocket client → server wire message type                 |
| `TServerMessage`              | type alias | WebSocket server → client wire message type                 |
| `createWsTransport`           | function   | Creates a WebSocket transport adapter (functional API)      |
| `IWsTransportOptions`         | interface  | Options for `createWsTransport`                             |
| `WsTransport`                 | class      | Configurable WebSocket transport (`IConfigurableTransport`) |
| `IWsTransportConfig`          | interface  | Config for `WsTransport`                                    |
| `IExecutionWorkspaceSnapshot` | interface  | Re-exported from `agent-framework`                          |
| `IExecutionWorkspaceEntry`    | interface  | Re-exported from `agent-framework`                          |
| `TExecutionWorkspaceStatus`   | type alias | Re-exported from `agent-framework`                          |
| `TExecutionAttention`         | type alias | Re-exported from `agent-framework`                          |

### `/mcp`

| Export                 | Kind      | Description                        |
| ---------------------- | --------- | ---------------------------------- |
| `createAgentMcpServer` | function  | Creates an MCP server adapter      |
| `IAgentMcpOptions`     | interface | Options for `createAgentMcpServer` |
| `createMcpTransport`   | function  | Creates an MCP transport adapter   |
| `IMcpTransportOptions` | interface | Options for `createMcpTransport`   |

### `/tui`

| Export                         | Kind       | Description                                                                                   |
| ------------------------------ | ---------- | --------------------------------------------------------------------------------------------- |
| `renderApp`                    | function   | Mounts Ink TUI; creates `TuiInteractionChannel` and resolves when the UI exits                |
| `IRenderOptions`               | interface  | All options for `renderApp()`                                                                 |
| `TuiTransport`                 | class      | Thin `IConfigurableTransport` wrapper; calls `renderApp()` on `start()`                       |
| `ITuiCliAdapter`               | interface  | Port for CLI-level side-effects (settings, git, model change)                                 |
| `IDefaultTuiCliAdapterOptions` | interface  | Options for `createDefaultTuiCliAdapter`                                                      |
| `createDefaultTuiCliAdapter`   | function   | Factory for the default `ITuiCliAdapter` implementation                                       |
| `TOnMissingArgsAction`         | type alias | Re-exported from `agent-interface-tui`                                                        |
| `ITuiPickerItem`               | interface  | Re-exported from `agent-interface-tui` — item shape for `CommandPicker`                       |
| `ITuiCommandInteraction`       | interface  | Re-exported from `agent-interface-tui`                                                        |
| `ITuiPickerInteraction`        | interface  | Re-exported from `agent-interface-tui` — picker interaction variant used by `CommandPicker`   |
| `ITuiConfirmInteraction`       | interface  | Re-exported from `agent-interface-tui` — confirm interaction variant used by `CommandConfirm` |
| `TAnyTuiCommandInteraction`    | type alias | Re-exported from `agent-interface-tui`                                                        |

### Root (`@robota-sdk/agent-transport`)

Root re-exports all sub-path exports plus:

| Export                           | Kind     | Description                                                                                                         |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `TransportRegistry`              | class    | Manages `IConfigurableTransport` instances with settings-backed enable/disable; orchestrates `startAll` / `stopAll` |
| `createDefaultTransportRegistry` | function | Creates a `TransportRegistry` pre-registered with `WsTransport` using user settings path                            |

## 6. Extension Points

| Extension Point             | Mechanism                                                                                | Description                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom transport adapter    | Implement `ITransportAdapter<IInteractiveSession>` from `agent-interface-transport`      | Receives a session via `attach()`, starts/stops via lifecycle methods                                                                             |
| Configurable transport      | Implement `IConfigurableTransport<IInteractiveSession>` from `agent-interface-transport` | Extends adapter with `name`, `defaultEnabled`, `optionsSchema`, and `validateOptions()`; registerable with `TransportRegistry`                    |
| Custom CLI adapter          | Implement `ITuiCliAdapter` from `@robota-sdk/agent-transport/tui`                        | Provides CLI-side operations (settings I/O, git, model switching) to the TUI layer                                                                |
| TUI command interactions    | Implement interaction types from `@robota-sdk/agent-interface-tui`                       | `ITuiCommandInteraction`, `ITuiPickerInteraction`, `ITuiConfirmInteraction` for slash-command UX                                                  |
| Tool filtering              | Pass `allowedTools` / `deniedTools` in `IRenderOptions`                                  | String arrays forwarded through `IProps` → `IInteractiveSessionProps` → session initialization; restrict which tools the agent may invoke         |
| Transport registry settings | Settings file under `transports` key                                                     | Shape: `{ "<name>": { "enabled": boolean, "options": { ... } } }`; read and written by `TransportRegistry` via `agent-framework` settings helpers |

## 7. Error Taxonomy

| Error                                       | Origin                                     | Behaviour                                                                                                                   |
| ------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `No session attached. Call attach() first.` | `createHeadlessTransport` → `start()`      | Thrown synchronously when `start()` is called before `attach()`                                                             |
| `config_error` (headless JSON output)       | `resolveErrorCode` in `headless-runner.ts` | Emitted in the `error_code` field of the JSON result when the error message matches `api key`, `no provider`, or `provider` |
| `tool_error` (headless JSON output)         | `resolveErrorCode` in `headless-runner.ts` | Emitted when error message matches `tool` or `execution`                                                                    |
| `api_error` (headless JSON output)          | `resolveErrorCode` in `headless-runner.ts` | Default fallback error code for unclassified errors                                                                         |
| Unhandled rejection (TUI)                   | `renderApp` in `render.tsx`                | Caught by a global `unhandledRejection` listener; written to `stderr` with stack trace; does not crash the TUI process      |
| Session not initialized (TUI polling)       | `TuiInteractionChannel` init check loop    | Swallowed silently; polling continues at 200 ms intervals until session is ready                                            |
| Transport start/stop errors                 | `TuiInteractionChannel` transport registry | `startAll` / `stopAll` errors are swallowed (`.catch(() => undefined)`) to avoid crashing the TUI                           |

## 8. Test Strategy

```bash
pnpm --filter @robota-sdk/agent-transport test
pnpm --filter @robota-sdk/agent-transport test:coverage
```

- Unit tests live in `src/**/__tests__/` co-located with source
- Headless runner modes (`text`, `json`, `stream-json`) are tested with mocked `IInteractiveSession`
- WebSocket protocol round-trips are tested with in-process `ws` connections
- TUI components tested with `ink-testing-library`; `TuiInteractionChannel.requestAction()` protocol tested without Ink
- `CommandPicker` and `CommandConfirm` dialog components tested in isolation with `ink-testing-library`
- `TransportRegistry` enable/disable logic is unit-tested with mock settings files
- Session-switch channel ownership (CLI-B11): `src/tui/__tests__/session-switch-channel.test.tsx`
  renders the real `App` with a mocked `createChannel` factory (factory call args/count,
  old-channel stop, consecutive A→B→C switches); `src/tui/__tests__/channel-factory-integration.test.ts`
  builds the channel via the real `toChannelOptions`/`TuiInteractionChannel` path over a real
  project session store and asserts restored context `usedTokens > 0`
- All tests run with Vitest; `--passWithNoTests` allows sub-directories without tests to pass CI

Expected baseline: 51 test files, ~431 tests, all passing.

## Test Harness Contracts (CLI-074)

**Scripted provider fixture** — `@robota-sdk/agent-transport/testing` (dev-only subpath;
never imported by runtime code): `createScriptedProvider(turns)` replays declared
text/tool_use turns through the real agent loop, records every `chat()` request's message
array in `requests`, and throws on script exhaustion (no improvised responses). Consumers:
agent-cli scripted E2E suites (tool loop, permission matrix, resume, output contracts,
slash smoke).

**PTY TUI project** — `src/tui/__tests__/pty/` runs against the BUILT robota binary in a
real pseudo-terminal (`@homebridge/node-pty-prebuilt-multiarch`, per-key paced input to
avoid bracketed-paste bundling). Dedicated vitest project: files use the `*.ptytest.ts`
suffix (excluded from the default `pnpm test` glob) and run via
`pnpm --filter @robota-sdk/agent-transport test:pty` after building agent-cli. Covered
contracts: boot render, slash autocomplete, `/help` command execution at human key rates,
`/exit` process exit within 10s.

## 9. Class Contract Registry

### `TuiInteractionChannel`

```typescript
class TuiInteractionChannel implements IInteractionChannel {
  readonly stateManager: TuiStateManager;
  pendingAction: IActionRequest | null;
  permissionRequest: IPermissionRequest | null;
  availableCommands: ICommandInfo[];
  isShuttingDown: boolean;
  sessionName: string | undefined;
  onChange: (() => void) | null; // set by useTuiChannel for React re-renders

  constructor(opts: ITuiInteractionChannelOptions): TuiInteractionChannel;

  // IInteractionChannel
  onSubmit(handler: (text: string) => Promise<void>): void;
  write(_event: InteractionEvent): void; // no-op; session events wired in start()
  requestAction(action: IActionRequest): Promise<IActionResponse>;
  setAvailableCommands(commands: ICommandInfo[]): void;
  setBusy(busy: boolean): void;
  start(): Promise<void>; // wires session events, starts transport registry
  stop(): Promise<void>;

  // App.tsx API
  getSession(): InteractiveSession;
  getRegistry(): CommandRegistry;
  getCommandEffectQueue(): ICommandEffectQueue;
  abort(): void;
  cancelQueue(): void;
  shutdown(options?: { reason?: TSessionEndReason }): Promise<void>;
  resolveAction(response: IActionResponse): void;
  handleInput(input: string): Promise<void>;
}
```

### `HeadlessInteractionChannel`

```typescript
class HeadlessInteractionChannel {
  constructor(options: IHeadlessInteractionChannelOptions): HeadlessInteractionChannel;
  run(prompt: string): Promise<void>; // creates session, runs runner, shuts down session
  getExitCode(): number; // 0 = success, 1 = error
}
```

`IHeadlessInteractionChannelOptions` accepts `resumeSessionId?: string` and
`forkSession?: boolean`, forwarded verbatim to `InteractiveSession` so print mode has the
same session resume/fork semantics as the TUI channel (`-c`/`-r`/`--fork-session` parity).
When `resumeSessionId` is set without `forkSession`, the existing session is continued
(same id, prior conversation messages restored); with `forkSession: true` a new independent
session id is created per the framework's fork semantics. The caller (agent-cli) resolves
ids and validates print-mode-impossible flag combinations before constructing the channel.

### `TuiTransport`

```typescript
class TuiTransport implements IConfigurableTransport<IInteractiveSession> {
  readonly name: 'tui';
  readonly defaultEnabled: true;
  readonly optionsSchema: {};
  constructor(options: IRenderOptions): TuiTransport;
  attach(_session: IInteractiveSession): void; // no-op: session created internally by TuiInteractionChannel
  start(): Promise<void>; // calls renderApp(); resolves on TUI exit
  stop(): Promise<void>; // no-op: Ink exits from within TUI
  validateOptions(_options: Record<string, TUniversalValue>): boolean;
}
```

### `TransportRegistry`

```typescript
class TransportRegistry {
  constructor(settingsPath: string): TransportRegistry;
  register(transport: IConfigurableTransport<IInteractiveSession>): void;
  getAll(): ITransportEntry<IInteractiveSession>[];
  getEnabled(): IConfigurableTransport<IInteractiveSession>[];
  setEnabled(name: string, enabled: boolean): Promise<void>;
  setOptions(name: string, options: Record<string, TUniversalValue>): Promise<void>;
  startAll(session: IInteractiveSession): Promise<void>; // attach + start for enabled transports
  stopAll(): Promise<void>; // stop all registered transports
}
```

### `WsTransport`

```typescript
class WsTransport implements IConfigurableTransport<IInteractiveSession> {
  readonly name: 'ws';
  constructor(config?: IWsTransportConfig): WsTransport;
  attach(session: IInteractiveSession): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  validateOptions(options: Record<string, TUniversalValue>): boolean;
}
```

### `IRenderOptions` shape (key fields)

```typescript
interface IRenderOptions {
  cwd: string;
  provider: IAIProvider;
  cliAdapter: ITuiCliAdapter;
  providerOverride?: string;
  providerType?: string;
  modelId?: string;
  language?: string;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  allowedTools?: string[]; // tool name allow-list (forwarded to session init)
  deniedTools?: string[]; // tool name deny-list (forwarded to session init)
  version?: string;
  sessionStore?: IInteractiveSessionStore;
  resumeSessionId?: string;
  showSessionPickerOnStart?: boolean;
  forkSession?: boolean;
  sessionName?: string;
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  subagentRunnerFactory?: TSubagentRunnerFactory;
  commandModules?: readonly ICommandModule[];
  commandHostAdapters?: ICommandHostAdapters;
  shellExec?: TShellExecFn;
  startupUpdateNotice?: Promise<string | undefined>;
  transportRegistry?: ITransportRegistryView<IInteractiveSession>;
  reloadPluginCommandSource?: (registry: CommandRegistry) => void;
  agentName?: string;
}
```

`toChannelOptions(options, resumeSessionId?)` maps `IRenderOptions` to the
`TuiInteractionChannel` constructor options (exported for contract tests).
