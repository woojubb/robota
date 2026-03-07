# Playground Specification

## Scope

Owns the Robota Playground UI package: React components, hooks, executor logic, plugins, and tool catalog for interactive agent experimentation in the browser. Provides `PlaygroundApp` and `PlaygroundDemo` components, `PlaygroundExecutor` for managing Robota agents via `RemoteExecutor`, and statistics/history plugins for real-time visualization.

## Boundaries

- Does not own core agent contracts (`IExecutor`, `IAIProvider`, `TUniversalMessage`); imports from `@robota-sdk/agents`.
- Does not own remote transport contracts; imports `RemoteExecutor` from `@robota-sdk/remote`.
- Does not own WebSocket message types; imports `IPlaygroundWebSocketMessage` from `@robota-sdk/remote`.
- Does not define deployment or hosting behavior; that belongs to `apps/web`.

## Architecture Overview

Facade-pattern executor (`PlaygroundExecutor`) wraps Robota agent instances for browser-based execution. AI providers are constructed with a `RemoteExecutor` so API keys stay server-side. Two plugins (`PlaygroundHistoryPlugin`, `PlaygroundStatisticsPlugin`) collect conversation events and UX metrics. React hooks (`usePlaygroundBoot`, `usePlaygroundData`, `useRobotaExecution`, etc.) provide state management. A `PlaygroundWebSocketClient` enables real-time communication with the API server. Tool catalog (`ToolRegistry`) provides built-in playground tools created via factory functions.

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

| Export | Kind | Description |
|--------|------|-------------|
| `PlaygroundApp` | React component | Full playground application shell |
| `PlaygroundDemo` | React component | Demo-mode playground |
| `PlaygroundExecutor` | class | Agent lifecycle and execution facade |
| `usePlaygroundBoot` | hook | Boot state management |
| Various hooks | hooks | `usePlaygroundData`, `useRobotaExecution`, `useChatInput`, etc. |
| `ToolRegistry` | object | Built-in tool factory registry |

## Extension Points

- `IPlaygroundTool` -- consumers can implement custom tools with `name`, `description`, `schema`, and `execute`.
- `IPlaygroundPlugin` -- consumers can implement custom plugins with `initialize` and `dispose` lifecycle.
- `ToolRegistry` -- tool factory functions that accept `IEventService` and return `FunctionTool`.

## Error Taxonomy

Errors are returned in `IPlaygroundExecutorResult` using the `IPlaygroundUiError` classification:

| Kind | Condition |
|------|-----------|
| `user_message` | Validation errors, invalid input, unknown tool |
| `fatal` | Strict-policy violations, path-only failures, no-fallback violations |
| `recoverable` | Transient/system errors (default classification) |

Runtime errors: `'No active agent to execute prompt'`, `'Server URL and auth token required'`, `'Unknown tool id'`, agent/tool registry lookup failures.

## Test Strategy

- **No test files found** in this package currently.
- Statistics types and plugin logic have no unit test coverage.
- React components and hooks have no test coverage.
- Recommended: unit tests for `PlaygroundExecutor` methods, `toPlaygroundUiError` classification, and statistics plugin recording.
