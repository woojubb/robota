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
  tui/
    render.tsx               ← renderApp, ITuiRenderOptions (Ink entry point)
    App.tsx                  ← App / AppInner root React component (IProps)
    tui-transport.ts         ← TuiTransport (IConfigurableTransport)
    tui-cli-adapter.ts       ← ITuiCliAdapter interface
    create-default-tui-cli-adapter.ts ← createDefaultTuiCliAdapter
    tui-state-manager.ts     ← TuiStateManager (internal)
    tui-cli-adapter-context.tsx ← React context for ITuiCliAdapter
    types.ts                 ← TPermissionResult, IPermissionRequest
    command-interaction.ts   ← re-exports from @robota-sdk/agent-interface-tui
    hooks/
      useInteractiveSession.ts ← useInteractiveSession, IInteractiveSessionProps
      usePermissionQueue.ts
      useSlashRouting.ts
      useSideEffects.ts
      usePluginCallbacks.ts
      useStatusLineSettings.ts
    index.ts
```

### TUI lifecycle

`TuiTransport` is constructed with `ITuiRenderOptions` and registered with `TransportRegistry`. On `start()`, it calls `renderApp()` which mounts the Ink `App` component. `App` delegates session management to the `useInteractiveSession` hook, which creates an `InteractiveSession` (via `agent-framework`) and wires all session events to `TuiStateManager` for re-renders.

### Headless lifecycle

`createHeadlessTransport(options)` returns an `ITransportAdapter` object. Callers call `attach(session)` then `start()`. `start()` delegates to `createHeadlessRunner` which chooses between `text`, `json`, or `stream-json` output modes. On completion `getExitCode()` returns `0` or `1`.

## 4. Type Ownership

| Type                           | Location                                                   | Purpose                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `ITuiRenderOptions`            | `src/tui/render.tsx`                                       | Options passed to `renderApp()` and consumed by `TuiTransport`; includes `allowedTools` and `deniedTools` for tool-name filtering |
| `IProps`                       | `src/tui/App.tsx` (internal)                               | React props for the root `App` / `AppInner` components; includes `allowedTools` and `deniedTools`                                 |
| `IInteractiveSessionProps`     | `src/tui/hooks/useInteractiveSession.ts`                   | Props for the `useInteractiveSession` hook; includes `allowedTools` and `deniedTools`                                             |
| `IInteractiveSessionState`     | `src/tui/hooks/useInteractiveSession.ts`                   | Return type of `useInteractiveSession`; full reactive TUI state                                                                   |
| `ITuiCliAdapter`               | `src/tui/tui-cli-adapter.ts`                               | Port interface for CLI-level operations (settings, git, model switching)                                                          |
| `IDefaultTuiCliAdapterOptions` | `src/tui/create-default-tui-cli-adapter.ts`                | Options for `createDefaultTuiCliAdapter`                                                                                          |
| `TPermissionResult`            | `src/tui/types.ts`                                         | Union: `boolean \| 'allow-session' \| 'allow-project'`                                                                            |
| `IPermissionRequest`           | `src/tui/types.ts`                                         | Pending permission request passed to `PermissionPrompt`                                                                           |
| `IHeadlessTransportOptions`    | `src/headless/headless-transport.ts`                       | Options for `createHeadlessTransport` (`outputFormat`, `prompt`)                                                                  |
| `IHeadlessRunnerOptions`       | `src/headless/headless-runner.ts`                          | Options for `createHeadlessRunner` (`session`, `outputFormat`)                                                                    |
| `TOutputFormat`                | `src/headless/headless-runner.ts`                          | `'text' \| 'json' \| 'stream-json'`                                                                                               |
| `IAgentRoutesOptions`          | `src/http/routes.ts`                                       | Options for `createAgentRoutes`                                                                                                   |
| `TSessionFactory`              | `src/http/routes.ts`                                       | Factory type for creating sessions in HTTP handlers                                                                               |
| `IHttpTransportOptions`        | `src/http/http-transport.ts`                               | Options for `createHttpTransport`                                                                                                 |
| `TClientMessage`               | `src/ws/ws-protocol.ts`                                    | WebSocket client → server message wire type                                                                                       |
| `TServerMessage`               | `src/ws/ws-protocol.ts`                                    | WebSocket server → client message wire type                                                                                       |
| `IWsHandlerOptions`            | `src/ws/ws-handler.ts`                                     | Options for `createWsHandler`                                                                                                     |
| `IWsTransportOptions`          | `src/ws/ws-transport.ts`                                   | Options for `createWsTransport`                                                                                                   |
| `IWsTransportConfig`           | `src/ws/ws-transport-configurable.ts`                      | Config for the `WsTransport` configurable class                                                                                   |
| `IAgentMcpOptions`             | `src/mcp/mcp-server.ts`                                    | Options for `createAgentMcpServer`                                                                                                |
| `IMcpTransportOptions`         | `src/mcp/mcp-transport.ts`                                 | Options for `createMcpTransport`                                                                                                  |
| `TOnMissingArgsAction`         | re-exported from `@robota-sdk/agent-interface-tui`         | Action when command args are missing                                                                                              |
| `ITuiPickerItem`               | re-exported from `@robota-sdk/agent-interface-tui`         | Item shape for picker interactions                                                                                                |
| `ITuiCommandInteraction`       | re-exported from `@robota-sdk/agent-interface-tui`         | Base command interaction type                                                                                                     |
| `ITuiPickerInteraction`        | re-exported from `@robota-sdk/agent-interface-tui`         | Picker interaction variant                                                                                                        |
| `ITuiConfirmInteraction`       | re-exported from `@robota-sdk/agent-interface-tui`         | Confirm interaction variant                                                                                                       |
| `TAnyTuiCommandInteraction`    | re-exported from `@robota-sdk/agent-interface-tui`         | Union of all TUI interaction types                                                                                                |
| `IExecutionWorkspaceSnapshot`  | re-exported from `@robota-sdk/agent-framework` (via `/ws`) | Snapshot of agent execution workspace                                                                                             |
| `IExecutionWorkspaceEntry`     | re-exported from `@robota-sdk/agent-framework` (via `/ws`) | Single entry in the execution workspace                                                                                           |
| `TExecutionWorkspaceStatus`    | re-exported from `@robota-sdk/agent-framework` (via `/ws`) | Status enum for workspace entries                                                                                                 |
| `TExecutionAttention`          | re-exported from `@robota-sdk/agent-framework` (via `/ws`) | Attention level for workspace entries                                                                                             |

## 5. Public API Surface

### `/headless`

| Export                      | Kind       | Description                                                                                |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `PrintTerminal`             | class      | Utility for formatted terminal output in headless mode                                     |
| `promptInput`               | function   | Reads a single line from stdin                                                             |
| `createHeadlessRunner`      | function   | Creates a runner with `run(prompt): Promise<number>`; supports text/json/stream-json modes |
| `IHeadlessRunnerOptions`    | interface  | Options for `createHeadlessRunner`                                                         |
| `TOutputFormat`             | type alias | `'text' \| 'json' \| 'stream-json'`                                                        |
| `createHeadlessTransport`   | function   | Returns `ITransportAdapter & { getExitCode(): number }` wrapping `createHeadlessRunner`    |
| `IHeadlessTransportOptions` | interface  | Options for `createHeadlessTransport`                                                      |

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

| Export                         | Kind       | Description                                                                                               |
| ------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------- |
| `TuiTransport`                 | class      | Ink/React TUI transport (`IConfigurableTransport<IInteractiveSession>`); calls `renderApp()` on `start()` |
| `ITuiCliAdapter`               | interface  | Port for CLI-level side-effects (settings, git, model change)                                             |
| `IDefaultTuiCliAdapterOptions` | interface  | Options for `createDefaultTuiCliAdapter`                                                                  |
| `createDefaultTuiCliAdapter`   | function   | Factory for the default `ITuiCliAdapter` implementation                                                   |
| `ITuiRenderOptions`            | interface  | All options for `renderApp()` and `TuiTransport`; includes `allowedTools` and `deniedTools`               |
| `TOnMissingArgsAction`         | type alias | Re-exported from `agent-interface-tui`                                                                    |
| `ITuiPickerItem`               | interface  | Re-exported from `agent-interface-tui`                                                                    |
| `ITuiCommandInteraction`       | interface  | Re-exported from `agent-interface-tui`                                                                    |
| `ITuiPickerInteraction`        | interface  | Re-exported from `agent-interface-tui`                                                                    |
| `ITuiConfirmInteraction`       | interface  | Re-exported from `agent-interface-tui`                                                                    |
| `TAnyTuiCommandInteraction`    | type alias | Re-exported from `agent-interface-tui`                                                                    |

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
| Tool filtering              | Pass `allowedTools` / `deniedTools` in `ITuiRenderOptions`                               | String arrays forwarded through `IProps` → `IInteractiveSessionProps` → session initialization; restrict which tools the agent may invoke         |
| Transport registry settings | Settings file under `transports` key                                                     | Shape: `{ "<name>": { "enabled": boolean, "options": { ... } } }`; read and written by `TransportRegistry` via `agent-framework` settings helpers |

## 7. Error Taxonomy

| Error                                       | Origin                                     | Behaviour                                                                                                                   |
| ------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `No session attached. Call attach() first.` | `createHeadlessTransport` → `start()`      | Thrown synchronously when `start()` is called before `attach()`                                                             |
| `config_error` (headless JSON output)       | `resolveErrorCode` in `headless-runner.ts` | Emitted in the `error_code` field of the JSON result when the error message matches `api key`, `no provider`, or `provider` |
| `tool_error` (headless JSON output)         | `resolveErrorCode` in `headless-runner.ts` | Emitted when error message matches `tool` or `execution`                                                                    |
| `api_error` (headless JSON output)          | `resolveErrorCode` in `headless-runner.ts` | Default fallback error code for unclassified errors                                                                         |
| Unhandled rejection (TUI)                   | `renderApp` in `render.tsx`                | Caught by a global `unhandledRejection` listener; written to `stderr` with stack trace; does not crash the TUI process      |
| Session not initialized (TUI polling)       | `useInteractiveSession` init check loop    | Swallowed silently; polling continues at 200 ms intervals until session is ready                                            |
| Transport start/stop errors                 | `useInteractiveSession` transport registry | `startAll` / `stopAll` errors are swallowed (`.catch(() => undefined)`) to avoid crashing the TUI                           |

## 8. Test Strategy

```bash
pnpm --filter @robota-sdk/agent-transport test
pnpm --filter @robota-sdk/agent-transport test:coverage
```

- Unit tests live in `src/**/__tests__/` co-located with source
- Headless runner modes (`text`, `json`, `stream-json`) are tested with mocked `IInteractiveSession`
- WebSocket protocol round-trips are tested with in-process `ws` connections
- TUI components are tested with `ink-testing-library`
- `TransportRegistry` enable/disable logic is unit-tested with mock settings files
- All tests run with Vitest; `--passWithNoTests` allows sub-directories without tests to pass CI

Expected baseline: 10 test files, ~80 tests, all passing.

## 9. Class Contract Registry

### `TuiTransport`

```typescript
class TuiTransport implements IConfigurableTransport<IInteractiveSession> {
  readonly name: 'tui';
  readonly defaultEnabled: true;
  readonly optionsSchema: {};
  constructor(options: ITuiRenderOptions): TuiTransport;
  attach(_session: IInteractiveSession): void; // no-op: session created internally
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

### `useInteractiveSession` hook contract

```typescript
function useInteractiveSession(props: IInteractiveSessionProps): IInteractiveSessionState;

// IInteractiveSessionProps (key fields):
// - cwd, provider, permissionMode, maxTurns
// - sessionStore, resumeSessionId, forkSession, sessionName
// - backgroundTaskRunners, subagentRunnerFactory
// - commandModules, commandHostAdapters, shellExec
// - transportRegistry, language, reloadPluginCommandSource
// - agentName, systemPrompt, appendSystemPrompt
// - allowedTools?: string[]   ← tool allow-list forwarded to session
// - deniedTools?: string[]    ← tool deny-list forwarded to session

// IInteractiveSessionState (key fields):
// - interactiveSession, registry, commandEffectQueue
// - history, addEntry, streamingText, activeTools
// - isThinking, isAborting, isShuttingDown, pendingPrompt
// - executionWorkspaceSnapshot, selectedExecutionEntryId
// - permissionRequest, contextState
// - handleSubmit, handleAbort, handleCancelQueue, handleShutdown
// - selectExecutionWorkspaceEntry, readExecutionWorkspaceDetail
```

### `ITuiRenderOptions` shape (key fields)

```typescript
interface ITuiRenderOptions {
  runtime: IAgentRuntime;
  cliAdapter: ITuiCliAdapter;
  providerOverride?: string;
  providerType?: string;
  modelId?: string;
  language?: string;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  version?: string;
  resumeSessionId?: string;
  showSessionPickerOnStart?: boolean;
  forkSession?: boolean;
  sessionName?: string;
  shellExec?: TShellExecFn;
  startupUpdateNotice?: Promise<string | undefined>;
  agentName?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  allowedTools?: string[]; // tool name allow-list
  deniedTools?: string[]; // tool name deny-list
}
```
