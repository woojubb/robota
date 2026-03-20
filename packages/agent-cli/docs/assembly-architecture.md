# Agent CLI — Assembly Architecture

How `@robota-sdk/agent-cli` is composed from lower-level packages.

## Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                      agent-cli                               │
│  Terminal UI (React + Ink), slash commands, permission UX     │
│  Assembles: FileSessionLogger → Session → render()           │
└──────────────┬──────────────────────────┬────────────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────────┐   ┌──────────────────────┐
│        agent-sdk         │   │     agent-core       │
│  Assembly layer:         │   │  (direct dep for     │
│  config, context,        │   │   type imports only)  │
│  system prompt builder,  │   └──────────────────────┘
│  re-exports              │
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
│         │ │ WebFetch   │ │ Server tools          │ │ DI       │
│         │ │ WebSearch  │ │                       │ │          │
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

## Layer Responsibilities

### Layer 0: agent-core (Foundation)

- **Owns:** Interfaces, abstractions, DI, event service, plugin system, tool registry, permissions, hooks
- **Dependencies:** Zero @robota-sdk dependencies
- **Rule:** Everything above depends on core. Core depends on nothing.

### Layer 1: Implementation Packages (Building Blocks)

- **agent-tools** — Built-in tool implementations (Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch). Depends on core for `IToolWithEventService`.
- **agent-provider-anthropic** — Anthropic AI provider (chat, streaming, server tools). Depends on core for `IAIProvider`.
- **agent-sessions** — Session lifecycle (Session class, ISessionLogger, SessionStore). Depends on core + tools + provider.

### Layer 2: agent-sdk (Assembly)

- **Composes** sessions + tools + provider + core into a coherent SDK
- **Adds** config loading, context loading, system prompt building
- **Re-exports** everything consumers need from a single entry point
- **Rule:** SDK is the composition layer. It wires building blocks but adds minimal logic.

### Layer 3: agent-cli (UI)

- **Consumes** SDK public API only
- **Adds** React + Ink terminal UI, slash commands, permission prompt UX, streaming display
- **Assembles at startup:** Creates `FileSessionLogger`, `SessionStore`, `Session` via SDK, renders UI
- **Rule:** CLI must not use core internals that should come through SDK/sessions.

## Assembly Flow (CLI Startup)

```
1. CLI parses args
2. CLI loads config + context         (via agent-sdk)
3. CLI creates FileSessionLogger      (from agent-sessions, via agent-sdk)
4. CLI creates SessionStore           (from agent-sessions, via agent-sdk)
5. CLI creates Session({              (from agent-sessions, via agent-sdk)
     config, context,
     sessionLogger,                   ← injected, not hardcoded
     sessionStore,                    ← injected, not hardcoded
     permissionHandler,               ← injected by CLI (React state callback)
     onTextDelta,                     ← injected by CLI (streaming display)
   })
6. Session internally creates:
   - Robota agent                     (from agent-core)
   - AnthropicProvider                (from agent-provider-anthropic)
   - Built-in tools                   (from agent-tools)
   - Permission wrapper               (using agent-core evaluatePermission)
7. CLI renders Ink TUI with Session
```

## What Goes Where

| Concern                        | Package             | NOT in               |
| ------------------------------ | ------------------- | -------------------- |
| Terminal UI, React components  | agent-cli           | —                    |
| Config/context loading         | agent-sdk           | agent-cli            |
| Session lifecycle, permissions | agent-sessions      | agent-sdk, agent-cli |
| Tool implementations           | agent-tools         | agent-sessions       |
| AI provider calls              | agent-provider-\*   | agent-sessions       |
| Logging destination (file/DB)  | ISessionLogger impl | Session class        |
| Session persistence            | SessionStore        | Session class        |
| Plugin system, events, DI      | agent-core          | anywhere else        |
| Interfaces, type contracts     | agent-core          | duplicated elsewhere |
