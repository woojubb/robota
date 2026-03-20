# Architecture

## Layer Structure

Robota SDK follows a strict bottom-up layered assembly model. Each layer builds on the layer below.

```
agent-cli         ← UI layer: Ink TUI, slash commands, permission prompts
  ↓
agent-sdk         ← Assembly layer: config, context, session factory, query()
  ↓
agent-sessions    ← Session lifecycle: permissions, hooks, compaction, persistence
agent-tools       ← Tool infrastructure + 8 built-in CLI tools
agent-providers   ← AI provider implementations (Anthropic, OpenAI, Google)
  ↓
agent-core        ← Foundation: Robota engine, abstractions, DI, events, plugins
```

## Package Roles

| Package             | Role                                                                                   | Layer        |
| ------------------- | -------------------------------------------------------------------------------------- | ------------ |
| **agent-core**      | Robota engine, execution loop, provider abstraction, permissions, hooks, plugin system | Foundation   |
| **agent-tools**     | ToolRegistry, FunctionTool, createZodFunctionTool, 8 built-in CLI tools                | General      |
| **agent-sessions**  | Session class with permission enforcement, context tracking, compaction                | General      |
| **agent-providers** | AnthropicProvider, OpenAIProvider, GoogleProvider                                      | General      |
| **agent-sdk**       | Assembly: config loading, context discovery, system prompt, createSession, query()     | SDK-specific |
| **agent-cli**       | Ink TUI: conversation UI, slash commands, permission prompts                           | CLI-specific |

## Dependency Flow

```
agent-cli ─→ agent-sdk ─→ agent-sessions ─→ agent-core
  │            ├─→ agent-tools ────────────→ agent-core
  │            ├─→ agent-provider-anthropic → agent-core
  │            └─────────────────────────→ agent-core  (types, permissions, hooks)
  └──────────────────────────────────────→ agent-core  (types only)
```

Rules:

- Dependencies are one-way. No cycles.
- `agent-core` has zero workspace dependencies (foundation).
- `agent-sessions` depends only on `agent-core` (generic — no tools or providers).
- Assembly (wiring tools + provider + prompt) happens in `agent-sdk`.

## Design Patterns

| Pattern         | Where                                        | Purpose                                       |
| --------------- | -------------------------------------------- | --------------------------------------------- |
| **Facade**      | `Robota`, `Session`                          | Single entry point hiding internal complexity |
| **Decorator**   | `PermissionEnforcer.wrapTools()`             | Wraps tools with permission checks            |
| **Strategy**    | `IAIProvider`, `ISessionLogger`              | Swappable implementations                     |
| **Factory**     | `createSession()`, `createZodFunctionTool()` | Object creation                               |
| **Null Object** | `SilentLogger`, `DefaultEventService`        | Safe no-op defaults                           |
| **Registry**    | `ToolRegistry`                               | Central tool management                       |
| **Composition** | `Session` → sub-components                   | Delegation over inheritance                   |

## Session Sub-Components

`Session` delegates to focused sub-components:

| Component                | Responsibility                                                      |
| ------------------------ | ------------------------------------------------------------------- |
| `PermissionEnforcer`     | Tool wrapping, permission checks, hook execution, output truncation |
| `ContextWindowTracker`   | Token usage tracking, auto-compact threshold                        |
| `CompactionOrchestrator` | Conversation summarization via LLM (PreCompact hook)                |

## Plugin Architecture

`agent-core` defines the `AbstractPlugin` base class. 8 plugin implementations have been extracted to separate `@robota-sdk/agent-plugin-*` packages to keep `agent-core` dependency-free. Only `EventEmitterPlugin` remains built-in.

Plugins integrate with the agent lifecycle via hooks: `beforeRun`, `afterRun`, `onError`, `onStreamChunk`, `beforeToolExecution`, `afterToolExecution`.

## Changes from v2.0.0

In v2.0.0, `agent-core` contained everything: tools, plugins, session management. In v3.0.0:

- **Tools** moved to `agent-tools` (FunctionTool, ToolRegistry, built-in tools)
- **Plugins** extracted to `agent-plugin-*` packages
- **Session** created as a new package (`agent-sessions`) with permission and hook support
- **SDK** created as a new assembly layer (`agent-sdk`) with config/context loading
- **CLI** created as a new terminal UI (`agent-cli`)
- **Permissions** and **Hooks** added to `agent-core` as general-purpose infrastructure
