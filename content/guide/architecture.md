# Architecture

## Layer Structure

Robota SDK follows a strict bottom-up layered assembly model. Each layer builds on the layer below.

```
agent-cli                ← TUI layer: Ink TUI, useInteractiveSession hook, permission prompts
agent-transport-http     ← HTTP transport: Hono-based REST adapter (Cloudflare Workers / Node.js / Lambda)
agent-transport-mcp      ← MCP transport: Model Context Protocol server adapter
agent-transport-ws       ← WebSocket transport: framework-agnostic real-time adapter
agent-transport-headless ← Headless transport: non-interactive execution with text/json/stream-json output
  ↓ (all five consume)
agent-sdk                ← Assembly layer: InteractiveSession, SystemCommandExecutor,
  │                          CommandRegistry, BuiltinCommandSource, SkillCommandSource,
  │                          config, context, session factory, query()
  ↓
agent-sessions    ← Session lifecycle: permissions, hooks, compaction, persistence
agent-tools       ← Tool infrastructure + 8 built-in CLI tools
agent-providers   ← AI provider implementations (Anthropic, OpenAI, Google)
  ↓
agent-core        ← Foundation: Robota engine, abstractions, DI, events, plugins
```

## Package Roles

| Package                      | Role                                                                                                                                                       | Layer        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **agent-core**               | Robota engine, execution loop, provider abstraction, permissions, hooks, plugin system, model definitions (SSOT)                                           | Foundation   |
| **agent-tools**              | ToolRegistry, FunctionTool, createZodFunctionTool, 8 built-in CLI tools                                                                                    | General      |
| **agent-sessions**           | Session class with permission enforcement, context tracking, compaction                                                                                    | General      |
| **agent-providers**          | AnthropicProvider, OpenAIProvider, GoogleProvider                                                                                                          | General      |
| **agent-sdk**                | Assembly: InteractiveSession, SystemCommandExecutor, CommandRegistry, BuiltinCommandSource, SkillCommandSource, config loading, context discovery, query() | SDK-specific |
| **agent-cli**                | Ink TUI: useInteractiveSession hook bridges SDK events → React state, permission prompts                                                                   | Transport    |
| **agent-transport-http**     | Hono-based HTTP/REST adapter — exposes InteractiveSession over HTTP (Cloudflare Workers, Node.js, AWS Lambda)                                              | Transport    |
| **agent-transport-mcp**      | Model Context Protocol adapter — exposes InteractiveSession as an MCP server for Claude and other MCP clients                                              | Transport    |
| **agent-transport-ws**       | Framework-agnostic WebSocket adapter — exposes InteractiveSession over real-time connections (works with any WS library)                                   | Transport    |
| **agent-transport-headless** | Non-interactive headless adapter — runs InteractiveSession without a terminal, outputting text, JSON, or stream-JSON                                       | Transport    |
| **agent-remote-client**      | HTTP client for calling a remote Robota agent exposed via agent-transport-http                                                                             | Client       |

## Dependency Flow

```
agent-cli              ─→ agent-sdk ─→ agent-sessions ─→ agent-core
agent-transport-http   ─→ agent-sdk    ├─→ agent-tools ────────────→ agent-core
agent-transport-mcp    ─→ agent-sdk    ├─→ agent-provider-anthropic → agent-core
agent-transport-ws     ─→ agent-sdk    └─────────────────────────→ agent-core
agent-transport-headless ─→ agent-sdk
agent-remote-client                    (HTTP client, no agent-sdk dependency)
```

## Data Flow: IHistoryEntry[]

`InteractiveSession` maintains history as `IHistoryEntry[]` — a universal timeline that includes both chat messages (user/assistant turns) and session events (tool calls, system events, status changes). This is the single source of truth for display and persistence.

```
User input
  → InteractiveSession.submit()
  → history appended: IHistoryEntry (kind: 'chat', role: 'user')
  → Session.run()
  → AI provider receives filtered view (chat-only IHistoryEntry[])
  → streaming response → text_delta / tool_start / tool_end events
  → history appended: IHistoryEntry (kind: 'chat', role: 'assistant')
  → event entries appended: IHistoryEntry (kind: 'event', ...)
  → thinking / context_update events emitted
  → clients (CLI, HTTP, MCP, WS, Headless) update their state from events
```

Key invariant: AI providers never receive event-kind entries. The session layer filters to chat-only entries before forwarding context to the provider. This keeps the provider interface clean while the full `IHistoryEntry[]` timeline remains available for UI rendering.

Rules:

- Dependencies are one-way. No cycles.
- `agent-core` has zero workspace dependencies (foundation).
- `agent-sessions` depends only on `agent-core` (generic — no tools or providers).
- Assembly (wiring tools + provider + prompt) happens in `agent-sdk`.
- `InteractiveSession` (in `agent-sdk`) is the gateway for all transport adapters. There is no separate `IAgentGateway` interface — transports consume `InteractiveSession` directly.
- `agent-cli` and all `agent-transport-*` packages depend only on `agent-sdk`; they do not access `agent-sessions` or `agent-core` directly.
- `agent-remote-client` is a standalone HTTP client; it does not depend on `agent-sdk`.

## Design Patterns

| Pattern         | Where                                                        | Purpose                                       |
| --------------- | ------------------------------------------------------------ | --------------------------------------------- |
| **Facade**      | `Robota`, `Session`, `InteractiveSession`                    | Single entry point hiding internal complexity |
| **Decorator**   | `PermissionEnforcer.wrapTools()`                             | Wraps tools with permission checks            |
| **Strategy**    | `IAIProvider`, `ISessionLogger`                              | Swappable implementations                     |
| **Factory**     | `InteractiveSession`, `createZodFunctionTool()`              | Object creation                               |
| **Null Object** | `SilentLogger`, `DefaultEventService`                        | Safe no-op defaults                           |
| **Registry**    | `ToolRegistry`, `CommandRegistry`                            | Central management of tools and commands      |
| **Composition** | `InteractiveSession` → `Session`; `Session` → sub-components | Delegation over inheritance                   |

## Session Sub-Components

`Session` delegates to focused sub-components:

| Component                | Responsibility                                                      |
| ------------------------ | ------------------------------------------------------------------- |
| `PermissionEnforcer`     | Tool wrapping, permission checks, hook execution, output truncation |
| `ContextWindowTracker`   | Token usage tracking, auto-compact threshold                        |
| `CompactionOrchestrator` | Conversation summarization via LLM (PreCompact hook)                |

## InteractiveSession

`InteractiveSession` (in `agent-sdk`) wraps `Session` via composition to provide an event-driven API suitable for any interactive client. It is the single gateway used by all transport adapters — CLI, HTTP, MCP, WebSocket, and Headless — with no additional gateway interface required.

Key responsibilities:

| Concern                   | Detail                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **submit / abort**        | `submit(input)` starts a run; `abort()` cancels the current run                                                                         |
| **cancelQueue**           | Cancels the pending queued prompt without aborting the in-flight run                                                                    |
| **Prompt queue**          | Queues a new prompt submitted while a run is in progress                                                                                |
| **Event emission**        | Emits typed events (`text_delta`, `tool_start`, `tool_end`, `thinking`, `context_update`, `error`) consumed by clients                  |
| **Universal history**     | Maintains `IHistoryEntry[]` — unified timeline of chat messages and session events; `getFullHistory()` returns the complete list        |
| **SystemCommandExecutor** | Embedded inside `InteractiveSession`. Intercepts built-in system commands (help, clear, compact, mode, model, etc.) before any LLM call |
| **CommandRegistry**       | Aggregates `BuiltinCommandSource` and `SkillCommandSource` for slash-command discovery                                                  |

The CLI's `useInteractiveSession` hook subscribes to these events and translates them into React state via `TuiStateManager`. `InteractiveSession` itself has no React dependency.

## Transport Layer

The transport layer exposes `InteractiveSession` over various protocols. Each transport is a thin adapter that bridges the protocol to the session's `submit` / `abort` / event API.

| Package                      | Protocol                       | Runtime                                        |
| ---------------------------- | ------------------------------ | ---------------------------------------------- |
| **agent-cli**                | Terminal (stdin)               | Node.js (Ink + React)                          |
| **agent-transport-http**     | HTTP / REST                    | Cloudflare Workers, Node.js, AWS Lambda (Hono) |
| **agent-transport-mcp**      | MCP                            | Node.js stdio / SSE (MCP SDK)                  |
| **agent-transport-ws**       | WebSocket                      | Any WS library (framework-agnostic)            |
| **agent-transport-headless** | stdin/stdout (non-interactive) | Node.js — text/json/stream-json output         |

All five packages import `InteractiveSession` from `agent-sdk`. None of them implement session logic — they only translate protocol messages into session calls and forward session events back to the caller.

All transport adapters implement the `ITransportAdapter` interface (defined in `agent-sdk/src/interactive/types.ts`), which provides a uniform lifecycle: `attach(session)` to bind a session, `start()` to begin serving, and `stop()` to shut down. Each transport package exports a factory function that returns an `ITransportAdapter` implementation.

`agent-remote-client` is a companion HTTP client that allows a remote process to call an agent exposed via `agent-transport-http`. It has no dependency on `agent-sdk`.

## Plugin Architecture

`agent-core` defines the `AbstractPlugin` base class. 9 plugin implementations are available as separate `@robota-sdk/agent-plugin-*` packages. `EventEmitterPlugin` is also built directly into `agent-core` so that consumers do not need an additional dependency for basic event emission.

Plugins integrate with the agent lifecycle via hooks: `beforeRun`, `afterRun`, `onError`, `onStreamChunk`, `beforeToolExecution`, `afterToolExecution`.

## Changes from v2.0.0

In v2.0.0, `agent-core` contained everything: tools, plugins, session management. In v3.0.0:

- **Tools** moved to `agent-tools` (FunctionTool, ToolRegistry, built-in tools)
- **Plugins** extracted to `agent-plugin-*` packages
- **Session** created as a new package (`agent-sessions`) with permission and hook support
- **SDK** created as a new assembly layer (`agent-sdk`) with config/context loading
- **CLI** created as a new terminal UI (`agent-cli`)
- **Permissions** and **Hooks** added to `agent-core` as general-purpose infrastructure
