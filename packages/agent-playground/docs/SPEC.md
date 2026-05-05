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

Facade-pattern executor (`PlaygroundExecutor`) wraps Robota agent instances for browser-based execution. AI providers are constructed with a `RemoteExecutor` so API keys stay server-side. Executor internals are a directory module under `src/lib/playground/robota-executor/` with `PlaygroundAgentSession`, remote provider construction, tool normalization, plugin factories, result shaping, and statistics recording split from the stateful facade while preserving the previous import path. Two plugins (`PlaygroundHistoryPlugin`, `PlaygroundStatisticsPlugin`) are standalone classes that collect conversation events and UX metrics.

React hooks (`usePlaygroundBoot`, `usePlaygroundData`, `useRobotaExecution`, etc.) provide state management; these hooks are used internally by the React components and are not part of the public package API. Chat input hook internals are a directory module under `src/hooks/use-chat-input/` with public hook/type exports preserved through `index.ts` and input-state calculation, explicit validation, focus wiring, and constants split into internal helpers. WebSocket connection hook internals are a directory module under `src/hooks/use-websocket-connection/` with public hook/type exports preserved through `index.ts` and state calculation, uptime tracking, constants, and handler registration split into internal helpers. Playground WebSocket client is a directory module under `src/lib/playground/websocket-client/` with connection state isolated in `PlaygroundWebSocketClient` and message constants, guards, builders, auth parsing, and event payload types kept as internal helpers while preserving the previous import path.

Block-tracking layer (`PlaygroundBlockCollector`, `LLMTracker`, `PlaygroundBlockVisualizationSubscriber`) handles execution block collection and real-time visualization data. Block tracking hooks are a directory module under `src/lib/playground/block-tracking/block-hooks/` with handler and block message creation logic split from the public hook factories while preserving the previous import path. Execution subscriber is a directory module under `src/lib/playground/execution-subscriber/` with SDK event guards, tool/execution handlers, block id generation, and step parsing split from the `ExecutionSubscriber` stateful bridge while preserving the previous import path. Tool catalog (`ToolRegistry`) provides built-in playground tools created via factory functions; it is used internally and is not exported from the public entry point.

Static component catalogs such as code editor examples and template gallery entries are directory modules under `src/components/playground/*-data/`; their `index.ts` files preserve the previous component import paths while keeping large data payloads out of one monolithic file. Individual plugin block is a directory module under `src/components/playground/individual-plugin-block/` with header, option input, options tab, stats tab, info tab, constants, and types split from the stateful block component while preserving the previous import path. Chat interface is a directory module under `src/components/playground/chat-interface/` with the public component facade, header, message list, input area, copy feedback, send controller, message factories, and simulated response helper split into internal files while preserving the previous import path. Execution tree visualizer is a directory module under `src/components/playground/execution-tree-visualizer/` with pure tree/stat calculations, header, content, node view, empty state, constants, and local types split from the component facade while preserving the previous import path. Execution tree debug is a directory module under `src/components/playground/execution-tree-debug/` with debug tree/raw block data builders, demo actions, state hook, header, tree card, and raw block sections split from the component facade while preserving the previous import path. Usage monitor is a directory module under `src/components/playground/usage-monitor/` with the public component facade, state hook, mock snapshot builder, usage color helper, header, metric, rate-limit, and feature sections split from the component facade while preserving the previous import path. Agent container block is a directory module under `src/components/playground/agent-container-block/` with the public component facade, resolved props, local state hook, role catalog, shell, header rows, details, capabilities, system-message, and action sections split from the team agent block while preserving the previous import path. Block tree is a directory module under `src/components/playground/block-visualization/block-tree/` with pure tree construction, collector snapshot/event hooks, expansion actions, controls, stats badges, action menu, and recursive content split from the visual tree facade while preserving the previous import path. Block visualization panel is a directory module under `src/components/playground/block-visualization/block-visualization-panel/` with tab state, header, tab content, statistics, type breakdown, height mapping, and inspector sections split from the panel facade while preserving the previous import path. Tool container block is a directory module under `src/components/playground/tool-container-block/` with tool creation, state actions, library search, header, item rendering, parameters, preview, status icon, class-name, schema access, and empty/content sections split from the tool block facade while preserving the previous import path. Error panel is a directory module under `src/components/playground/error-panel/` with issue types/config, severity sorting, debug-info generation, copied/expanded state, summary, issue card, header, detail, and detail sections split from the panel facade while preserving the previous import path.

Shared accessibility UI primitives are a directory module under `src/components/ui/accessibility/` with `index.ts` preserving the previous import path. Demo execution data is a directory module under `src/lib/playground/demo-execution-data/` with the public generator functions in `index.ts` and the large scenario payload isolated in `scenario.ts`. Code analysis is a directory module under `src/lib/playground/code-analyzer/` with public analyzer, environment validation, and config parser functions re-exported from `index.ts`. Project management is a directory module under `src/lib/playground/project-manager/` with storage parsing, import validation, defaults, statistics, and id generation split from the `ProjectManager` stateful facade while preserving the previous import path.

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

| Port (Owner)                           | Consumer                    | Location                               |
| -------------------------------------- | --------------------------- | -------------------------------------- |
| `Robota` (agent-core)                  | `PlaygroundExecutor`        | `src/lib/playground/robota-executor/`  |
| `FunctionTool` (agent-tools)           | Tool factory functions      | `src/tools/`                           |
| `RemoteExecutor` (agent-remote-client) | `PlaygroundExecutor`        | `src/lib/playground/robota-executor/`  |
| `IPlaygroundWebSocketMessage` (local)  | `PlaygroundWebSocketClient` | `src/lib/playground/websocket-client/` |

## Test Strategy

- `components/ui/__tests__/button.test.tsx` covers the shared button primitive.
- `components/ui/__tests__/accessibility.test.tsx` characterizes shared accessibility primitives,
  keyboard navigation, and announcer timing.
- `components/playground/__tests__/code-editor-templates.test.ts` characterizes the public code editor template keys, default template, and required metadata.
- `components/playground/__tests__/template-gallery-data.test.ts` characterizes curated gallery template ids, display-map alignment, and required metadata.
- `components/playground/__tests__/individual-plugin-block.test.tsx` characterizes collapsed
  plugin summary, enabled toggling, option editing, stats tab, and info tab behavior.
- `components/playground/__tests__/chat-interface.test.tsx` characterizes disabled empty state,
  ready-agent send/loading/response flow, Enter submission, error retry restoration, and clearing.
- `components/playground/__tests__/execution-tree-visualizer.test.tsx` characterizes empty state,
  status/duration statistics, sorted hierarchy rendering, filtering, selection, and expand toggles.
- `components/playground/__tests__/execution-tree-debug.test.tsx` characterizes empty debug panes,
  clear behavior, real-time block hierarchy/raw previews, and demo generation controls.
- `components/playground/__tests__/block-tree.test.tsx` characterizes block stats badges, debug
  metadata toggling, hierarchy expansion, selection, collector event updates, and clear handling.
- `components/playground/__tests__/block-visualization-panel.test.tsx` characterizes panel tabs,
  collector-driven stats/type summaries, block selection callbacks, inspector rendering, and
  inspector clearing.
- `components/playground/__tests__/tool-container-block.test.tsx` characterizes empty editable
  state, filtered tool-library addition, expanded parameter editing, toggling, execution, removal,
  and validation error display.
- `components/playground/__tests__/error-panel.test.tsx` characterizes no-issue rendering,
  severity summary/sorting, issue detail expansion, suggestion callbacks, documentation links, and
  debug-info copying.
- `components/playground/__tests__/usage-monitor.test.tsx` characterizes hidden rendering, mock
  usage and rate-limit display, feature availability, and close action behavior.
- `components/playground/__tests__/agent-container-block.test.tsx` characterizes collapsed team
  summary rendering, expanded details, editing, action callbacks, and drag callback forwarding.
- `lib/playground/__tests__/demo-execution-data.test.ts` characterizes the demo block sequence,
  timing offsets, and complex-demo wrapper behavior.
- `lib/playground/__tests__/code-analyzer.test.ts` characterizes analyzer diagnostics,
  environment validation, and agent config parsing.
- `lib/playground/__tests__/project-manager.test.ts` characterizes project creation, storage
  restoration, import validation, update/duplicate/search/export, and statistics behavior.
- `lib/playground/block-tracking/__tests__/block-hooks.test.ts` characterizes block tracking hook
  start, completion, error, missing execution id, and delegation wrapper behavior.
- `lib/playground/__tests__/execution-subscriber.test.ts` characterizes SDK tool lifecycle,
  progress, hierarchy lifecycle, and dispose handling for execution subscriber behavior.
- `lib/playground/__tests__/websocket-client.test.ts` characterizes WebSocket URL construction,
  connection events, timestamped outbound messages, authentication, and update routing.
- `lib/playground/__tests__/robota-executor.test.ts` characterizes remote executor URL
  construction, provider wiring, tool normalization, execution result shaping, agent configuration
  updates, missing-credential errors, and disposal behavior.
- `hooks/__tests__/use-websocket-connection.test.tsx` characterizes connection state, explicit
  auth setup, disconnect statistics, send availability, error handling, health reporting, ping
  rejection, and handler unregistration for the WebSocket connection hook.
- `hooks/__tests__/use-chat-input.test.tsx` characterizes input state calculation, typing timeout,
  append/clear/cursor controls, explicit validation, sending, streaming, failure restoration, retry,
  and current placeholder chat-history behavior for the chat input hook.
- Statistics types and plugin logic have no unit test coverage.
- Most React components and hooks have no behavioral test coverage.
- Recommended: focused unit tests for `toPlaygroundUiError` classification, statistics plugin
  recording, and hook-level state transitions before further decomposition.
