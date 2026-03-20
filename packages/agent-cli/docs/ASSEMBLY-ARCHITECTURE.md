# Agent CLI — Assembly Architecture

How `@robota-sdk/agent-cli` is composed from lower-level packages.

## Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                      agent-cli                               │
│  Terminal UI (React + Ink), slash commands, permission UX     │
│  Assembles: createSession() → FileSessionLogger → render()   │
└──────────────┬──────────────────────────┬────────────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────────┐   ┌──────────────────────┐
│        agent-sdk         │   │     agent-core       │
│  Assembly layer:         │   │  (direct dep for     │
│  createSession(),        │   │   type imports only)  │
│  createDefaultTools(),   │   └──────────────────────┘
│  createProvider(),       │
│  config, context,        │
│  system prompt builder   │
└──────────┬───────────────┘
           │ composes
     ┌─────┼──────────┬─────────────────┐
     ▼     ▼          ▼                 ▼
┌─────────┐ ┌────────────┐ ┌───────────────────────┐ ┌──────────┐
│ agent-  │ │  agent-    │ │ agent-provider-       │ │ agent-   │
│sessions │ │  tools     │ │ anthropic             │ │  core    │
│         │ │            │ │                       │ │          │
│ Session │ │ Bash, Read │ │ AnthropicProvider     │ │ Robota   │
│ Logger  │ │ Write,Edit │ │ (Anthropic SDK)       │ │ Plugins  │
│ Store   │ │ Glob, Grep │ │ Streaming             │ │ Events   │
│Enforcer │ │ WebFetch   │ │ Server tools          │ │ DI       │
│Tracker  │ │ WebSearch  │ │                       │ │          │
│Compactor│ │            │ │                       │ │          │
└────┬────┘ └─────┬──────┘ └───────────┬───────────┘ └────┬─────┘
     │            │                    │                   │
     └────────────┴────────────────────┴───────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  agent-core  │
                    │              │
                    │ Interfaces   │
                    │ Abstractions │
                    │ Plugin system│
                    │ Event service│
                    │ Tool registry│
                    │ Permissions  │
                    │ Hooks        │
                    └──────────────┘
```

**Key change:** `agent-sessions` now depends only on `agent-core`. Tools and provider dependencies moved to `agent-sdk` (assembly layer).

## Layer Responsibilities

### Layer 0: agent-core (Foundation)

- **Owns:** Interfaces, abstractions, DI, event service, plugin system, tool registry, permissions, hooks
- **Dependencies:** Zero @robota-sdk dependencies
- **Rule:** Everything above depends on core. Core depends on nothing.

### Layer 1: Implementation Packages (Building Blocks)

- **agent-tools** — Built-in tool implementations (Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch). Depends on core for `IToolWithEventService`.
- **agent-provider-anthropic** — Anthropic AI provider (chat, streaming, server tools). Depends on core for `IAIProvider`.
- **agent-sessions** — Generic session lifecycle (Session, PermissionEnforcer, ContextWindowTracker, CompactionOrchestrator, SessionStore). Depends on core only. Accepts tools and provider as constructor arguments.

### Layer 2: agent-sdk (Assembly)

- **Assembles** tools + provider + system prompt → Session via `createSession()`
- **Factories:** `createDefaultTools()`, `createProvider()`, `createSession()`
- **Adds** config loading, context loading, system prompt building
- **Exports** assembly functions + backward-compatible re-exports
- **Rule:** SDK is the composition layer. It wires building blocks but adds minimal logic.

### Layer 3: agent-cli (UI)

- **Consumes** SDK public API (primarily `createSession()`)
- **Adds** React + Ink terminal UI, slash commands, permission prompt UX, streaming display
- **Assembles at startup:** Creates `FileSessionLogger`, `SessionStore`, calls `createSession()`, renders UI
- **Rule:** CLI must not use core internals that should come through SDK/sessions.

## Assembly Flow (CLI Startup)

```
1. CLI parses args
2. CLI loads config + context         (via agent-sdk)
3. CLI creates FileSessionLogger      (from agent-sessions, via agent-sdk)
4. CLI creates SessionStore           (from agent-sessions, via agent-sdk)
5. CLI calls createSession({          (from agent-sdk assembly)
     config, context,
     sessionLogger,                   ← injected, not hardcoded
     sessionStore,                    ← injected, not hardcoded
     permissionHandler,               ← injected by CLI (React state callback)
     onTextDelta,                     ← injected by CLI (streaming display)
   })
6. createSession() internally:
   - Creates AnthropicProvider        (via createProvider)
   - Creates default tools            (via createDefaultTools)
   - Builds system prompt             (via buildSystemPrompt)
   - Passes all to new Session()      (generic Session, no hardcoded deps)
7. Session internally:
   - Wraps tools with PermissionEnforcer (using agent-core evaluatePermission)
   - Creates ContextWindowTracker
   - Creates CompactionOrchestrator
   - Creates Robota agent             (from agent-core)
8. CLI renders Ink TUI with Session
```

## What Goes Where

| Concern                        | Package             | NOT in               |
| ------------------------------ | ------------------- | -------------------- |
| Terminal UI, React components  | agent-cli           | —                    |
| Config/context loading         | agent-sdk           | agent-cli            |
| Session factory (assembly)     | agent-sdk           | agent-sessions       |
| Tool + provider creation       | agent-sdk           | agent-sessions       |
| System prompt building         | agent-sdk           | agent-sessions       |
| Session lifecycle, permissions | agent-sessions      | agent-sdk, agent-cli |
| Tool implementations           | agent-tools         | agent-sessions       |
| AI provider calls              | agent-provider-\*   | agent-sessions       |
| Logging destination (file/DB)  | ISessionLogger impl | Session class        |
| Session persistence            | SessionStore        | Session class        |
| Plugin system, events, DI      | agent-core          | anywhere else        |
| Interfaces, type contracts     | agent-core          | duplicated elsewhere |
