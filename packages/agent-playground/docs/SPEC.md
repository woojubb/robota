# Playground Specification

## Scope

Owns the Robota Playground UI package: React components, hooks, executor logic, plugins, and tool catalog for interactive agent experimentation in the browser. Provides `PlaygroundApp` and `PlaygroundDemo` components, a browser-safe `@robota-sdk/agent-playground/client` component entry, `PlaygroundExecutor` for managing Robota agents via `RemoteExecutor`, and statistics/history plugins for real-time visualization.

## Boundaries

- Does not own core agent contracts (`IExecutor`, `IAIProvider`, `TUniversalMessage`); imports from `@robota-sdk/agent-core`.
- Does not own remote transport contracts; imports `RemoteExecutor` from `@robota-sdk/agent-remote-client`.
- Does not own WebSocket transport hosting; playground WebSocket message types are local UI
  contracts in `src/lib/playground/types.ts`.
- Does not define deployment or hosting behavior; that belongs to `apps/agent-web`.

## Architecture Overview

Facade-pattern executor (`PlaygroundExecutor`) wraps Robota agent instances for browser-based execution. AI providers are constructed with a `RemoteExecutor` so API keys stay server-side. Two plugins (`PlaygroundHistoryPlugin`, `PlaygroundStatisticsPlugin`) are standalone classes that collect conversation events and UX metrics. React hooks (`usePlaygroundBoot`, `usePlaygroundData`, `useRobotaExecution`, etc.) provide state management; these hooks are used internally by the React components and are not part of the public package API. A `PlaygroundWebSocketClient` enables real-time communication with the API server. Block-tracking layer (`PlaygroundBlockCollector`, `LLMTracker`, `PlaygroundBlockVisualizationSubscriber`) handles execution block collection and real-time visualization data. Tool catalog (`ToolRegistry`) provides built-in playground tools created via factory functions; it is used internally and is not exported from the public entry point. Static component catalogs such as code editor examples and template gallery entries are directory modules under `src/components/playground/*-data/`; their `index.ts` files preserve the previous component import paths while keeping large data payloads out of one monolithic file. Shared accessibility UI primitives are a directory module under `src/components/ui/accessibility/` with `index.ts` preserving the previous import path. Demo execution data is a directory module under `src/lib/playground/demo-execution-data/` with the public generator functions in `index.ts` and the large scenario payload isolated in `scenario.ts`. Code analysis is a directory module under `src/lib/playground/code-analyzer/` with public analyzer, environment validation, and config parser functions re-exported from `index.ts`. Project management is a directory module under `src/lib/playground/project-manager/` with storage parsing, import validation, defaults, statistics, and id generation split from the `ProjectManager` stateful facade while preserving the previous import path.

## Type Ownership

This package is SSOT for:

- `IPlaygroundAgentConfig` -- playground-specific agent configuration.
- `IPlaygroundExecutorResult` -- execution result with visualization data and UI error.
- `IPlaygroundTool` / `IPlaygroundPlugin` -- playground tool and plugin contracts.
- `TPlaygroundMode` -- execution mode (`'agent'`).
- `IPlaygroundUiError` / `TPlaygroundUiErrorKind` -- UI-facing error classification.
- `IPlaygroundMetrics` / `IPlaygroundStatisticsOptions` / `IPlaygroundStatisticsStats` -- statistics types.
- `IPlaygroundAction` -- UI interaction action type.
- `IPlaygroundExecutionResult` -- statistics execution result.
- `IPlaygroundBootState` -- boot hook state.
- `PLAYGROUND_STATISTICS_EVENTS` -- statistics event constants.

## Public API Surface

| Export                  | Kind            | Description                                                      |
| ----------------------- | --------------- | ---------------------------------------------------------------- |
| `PlaygroundApp`         | React component | Full playground application shell                                |
| `PlaygroundDemo`        | React component | Demo-mode playground                                             |
| `PlaygroundExecutor`    | class           | Agent lifecycle and execution facade (re-exported from services) |
| ~~`usePlaygroundBoot`~~ | hook (internal) | Boot state management — not exported from package entry          |

Browser consumers that only render the React playground must import `PlaygroundApp` and `PlaygroundDemo` from `@robota-sdk/agent-playground/client`. The root entry also exports service-layer APIs for server/runtime consumers and must not be used as the browser page entry.

Note: `usePlaygroundData`, `useRobotaExecution`, `useChatInput`, and `ToolRegistry` are used internally by the package's own components and are not exported from the public entry point (`src/index.ts → src/playground/index.ts`).

## Extension Points

- `IPlaygroundTool` -- consumers can implement custom tools with `name`, `description`, `schema`, and `execute`.
- `IPlaygroundPlugin` -- consumers can implement custom plugins with `initialize` and `dispose` lifecycle.
- `ToolRegistry` -- tool factory functions that accept `IEventService` and return `FunctionTool`.

## Error Taxonomy

Errors are returned in `IPlaygroundExecutorResult` using the `IPlaygroundUiError` classification:

| Kind           | Condition                                                            |
| -------------- | -------------------------------------------------------------------- |
| `user_message` | Validation errors, invalid input, unknown tool                       |
| `fatal`        | Strict-policy violations, path-only failures, no-fallback violations |
| `recoverable`  | Transient/system errors (default classification)                     |

Runtime errors: `'No active agent to execute prompt'`, `'Server URL and auth token required'`, `'Unknown tool id'`, agent/tool registry lookup failures.

## Class Contract Registry

### Interface Implementations

| Interface                   | Implementor                | Kind       | Location                                               |
| --------------------------- | -------------------------- | ---------- | ------------------------------------------------------ |
| `IPlaygroundBlockCollector` | `PlaygroundBlockCollector` | production | `src/lib/playground/block-tracking/block-collector.ts` |

### Inheritance Chains

None. `PlaygroundStatisticsPlugin` and `PlaygroundHistoryPlugin` are standalone classes that do not extend any base class.

### Cross-Package Port Consumers

| Port (Owner)                           | Consumer                    | Location                                 |
| -------------------------------------- | --------------------------- | ---------------------------------------- |
| `Robota` (agent-core)                  | `PlaygroundExecutor`        | `src/lib/playground/robota-executor.ts`  |
| `FunctionTool` (agent-tools)           | Tool factory functions      | `src/tools/`                             |
| `RemoteExecutor` (agent-remote-client) | `PlaygroundExecutor`        | `src/lib/playground/robota-executor.ts`  |
| `IPlaygroundWebSocketMessage` (local)  | `PlaygroundWebSocketClient` | `src/lib/playground/websocket-client.ts` |

## Test Strategy

- `components/ui/__tests__/button.test.tsx` covers the shared button primitive.
- `components/ui/__tests__/accessibility.test.tsx` characterizes shared accessibility primitives,
  keyboard navigation, and announcer timing.
- `components/playground/__tests__/code-editor-templates.test.ts` characterizes the public code editor template keys, default template, and required metadata.
- `components/playground/__tests__/template-gallery-data.test.ts` characterizes curated gallery template ids, display-map alignment, and required metadata.
- `lib/playground/__tests__/demo-execution-data.test.ts` characterizes the demo block sequence,
  timing offsets, and complex-demo wrapper behavior.
- `lib/playground/__tests__/code-analyzer.test.ts` characterizes analyzer diagnostics,
  environment validation, and agent config parsing.
- `lib/playground/__tests__/project-manager.test.ts` characterizes project creation, storage
  restoration, import validation, update/duplicate/search/export, and statistics behavior.
- Statistics types and plugin logic have no unit test coverage.
- React components and hooks have no behavioral test coverage.
- Recommended: unit tests for `PlaygroundExecutor` methods, `toPlaygroundUiError` classification, statistics plugin recording, and hook-level state transitions before further decomposition.
