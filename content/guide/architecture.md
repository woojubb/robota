# Architecture

## Layer Structure

Robota SDK follows a strict bottom-up layered assembly model. Each layer builds on the layer below.

```
agent-cli         ← TUI layer: Ink TUI, useInteractiveSession hook, permission prompts
  ↓
agent-sdk         ← Assembly layer: InteractiveSession, SystemCommandExecutor,
  │                  CommandRegistry, BuiltinCommandSource, SkillCommandSource,
  │                  config, context, session factory, query()
  ↓
agent-sessions    ← Session lifecycle: permissions, hooks, compaction, persistence
agent-tools       ← Tool infrastructure + 8 built-in CLI tools
agent-providers   ← AI provider implementations (Anthropic, OpenAI, Google)
  ↓
agent-core        ← Foundation: Robota engine, abstractions, DI, events, plugins
```

## Package Roles

| Package             | Role                                                                                                                                                                      | Layer        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **agent-core**      | Robota engine, execution loop, provider abstraction, permissions, hooks, plugin system, model definitions (SSOT)                                                          | Foundation   |
| **agent-tools**     | ToolRegistry, FunctionTool, createZodFunctionTool, 8 built-in CLI tools                                                                                                   | General      |
| **agent-sessions**  | Session class with permission enforcement, context tracking, compaction                                                                                                   | General      |
| **agent-providers** | AnthropicProvider, OpenAIProvider, GoogleProvider                                                                                                                         | General      |
| **agent-sdk**       | Assembly: InteractiveSession, SystemCommandExecutor, CommandRegistry, BuiltinCommandSource, SkillCommandSource, config loading, context discovery, createSession, query() | SDK-specific |
| **agent-cli**       | Ink TUI: useInteractiveSession hook bridges SDK events → React state, permission prompts                                                                                  | CLI-specific |

## Dependency Flow

```
agent-cli ─→ agent-sdk ─→ agent-sessions ─→ agent-core
               ├─→ agent-tools ────────────→ agent-core
               ├─→ agent-provider-anthropic → agent-core
               └─────────────────────────→ agent-core  (types, permissions, hooks)
```

Rules:

- Dependencies are one-way. No cycles.
- `agent-core` has zero workspace dependencies (foundation).
- `agent-sessions` depends only on `agent-core` (generic — no tools or providers).
- Assembly (wiring tools + provider + prompt) happens in `agent-sdk`.
- `InteractiveSession` (SDK) wraps `Session` (sessions) via composition, not inheritance.
- `agent-cli` depends only on `agent-sdk`; it does not access `agent-sessions` or `agent-core` directly.

## Design Patterns

| Pattern         | Where                                                        | Purpose                                       |
| --------------- | ------------------------------------------------------------ | --------------------------------------------- |
| **Facade**      | `Robota`, `Session`, `InteractiveSession`                    | Single entry point hiding internal complexity |
| **Decorator**   | `PermissionEnforcer.wrapTools()`                             | Wraps tools with permission checks            |
| **Strategy**    | `IAIProvider`, `ISessionLogger`                              | Swappable implementations                     |
| **Factory**     | `createSession()`, `createZodFunctionTool()`                 | Object creation                               |
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

`InteractiveSession` (in `agent-sdk`) wraps `Session` via composition to provide an event-driven API suitable for any interactive client: CLI, web, API server, or dynamic worker.

Key responsibilities:

| Concern                   | Detail                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| **submit / abort**        | `submit(input)` starts a run; `abort()` cancels the current run                                         |
| **cancelQueue**           | Cancels the pending queued prompt without aborting the in-flight run                                    |
| **Prompt queue**          | Queues a new prompt submitted while a run is in progress                                                |
| **Event emission**        | Emits typed events (`textDelta`, `message`, `statusChange`, etc.) consumed by clients                   |
| **SystemCommandExecutor** | Handles built-in system commands (help, clear, compact, mode, model, etc.) before forwarding to the LLM |
| **CommandRegistry**       | Aggregates `BuiltinCommandSource` and `SkillCommandSource` for slash-command discovery                  |

The CLI's `useInteractiveSession` hook subscribes to these events and translates them into React state. `InteractiveSession` itself has no React dependency.

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
