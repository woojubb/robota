# SDK Package Scope Redesign

## Summary

Redefine the scope and boundaries of agent-sdk, clarifying its relationship with agent-cli, agent-core, and transport packages. Consolidate InteractiveSession as the single entry point, embed SystemCommandExecutor, make SDK provider-neutral.

## Confirmed Decisions

| #   | Decision                    | Choice                                                                                          |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | SDK's primary audience      | Universal product. CLI is one of many consumers                                                 |
| 2   | Provider selection          | Consumer injects provider. SDK is provider-neutral (remove agent-provider-anthropic dependency) |
| 3   | CLI's role                  | Minimal TUI. Creates provider, renders InteractiveSession events                                |
| 4   | Session entry point         | InteractiveSession is the only public session API. createSession() becomes internal             |
| 5   | query() API                 | createQuery({ provider }) factory pattern. Returns a prompt-only function                       |
| 6   | SystemCommandExecutor       | Embedded inside InteractiveSession. session.executeCommand('clear', args)                       |
| 7   | CommandRegistry             | Stays in SDK. InteractiveSession manages internally                                             |
| 8   | Transport packages          | Consume InteractiveSession only (no separate commandExecutor param)                             |
| 9   | InteractiveSession creation | cwd + provider only. Config/context loading is internal                                         |
| 10  | CLI → sessions import       | Forbidden. SDK owns its own permission types                                                    |

## Architecture After Redesign

```
agent-core           ← types, abstractions, utilities (unchanged)
agent-sessions       ← Session, permissions, compaction (unchanged)
agent-tools          ← tool infrastructure + 8 built-in tools (unchanged)
agent-provider-*     ← provider implementations (unchanged)

agent-sdk            ← InteractiveSession (single entry point)
  ├── embedded: SystemCommandExecutor (session.executeCommand())
  ├── embedded: CommandRegistry, BuiltinCommandSource, SkillCommandSource, PluginCommandSource
  ├── internal: createSession(), createDefaultTools(), loadConfig(), loadContext()
  ├── exposed: createQuery({ provider }) → (prompt) => result
  └── NO provider dependency

agent-cli            ← minimal TUI
  ├── creates provider (reads config, picks provider package)
  ├── creates InteractiveSession({ cwd, provider })
  ├── subscribes to events → renders to terminal
  └── owns: slash prefix parsing, Ink components, paste handling, CJK input

agent-transport-http ← createAgentRoutes({ sessionFactory })
agent-transport-mcp  ← createAgentMcpServer({ session })
agent-transport-ws   ← createWsHandler({ session, send })
```

## Package Ownership Map

### agent-core

Role: Foundation contracts and abstractions

Owns:

- Message types: TUniversalMessage, IBaseMessage, TMessageState
- Message factories: createSystemMessage, createUserMessage, createAssistantMessage, createToolMessage
- Message type guards: isToolMessage, isAssistantMessage
- Permission evaluation: evaluatePermission(), TPermissionMode, IPermissionLists, TToolArgs
- Model definitions: CLAUDE_MODELS, getModelName, formatTokenCount, DEFAULT_MAX_OUTPUT
- Abstractions: AbstractAIProvider, IExecutor, IEventService
- Hooks: runHooks, CommandExecutor, HttpExecutor

Public (any package can import): types, factories, utilities, abstract classes
Internal (only through SDK/sessions): Robota, ExecutionService, ConversationStore

### agent-sessions

Role: Session lifecycle

Owns:

- Session (run, abort, permissions, compaction, hooks execution)
- TPermissionHandler, TPermissionResult
- ISessionOptions
- FileSessionLogger, SilentSessionLogger, ISessionLogger
- SessionStore, ISessionRecord

### agent-tools

Role: Tool infrastructure + built-in tools

Owns:

- ToolRegistry, FunctionTool, createFunctionTool, createZodFunctionTool
- TToolResult, zodToJsonSchema
- 8 built-in tools: bash, read, write, edit, glob, grep, webFetch, webSearch

### agent-provider-\*

Role: AI provider implementations

Owns:

- Provider class (AnthropicProvider, GoogleProvider, etc.)
- Provider-specific option types

### agent-sdk

Role: Assembly canvas + interaction layer

Owns:

- InteractiveSession (single entry point for all consumers)
  - constructor({ cwd, provider }) — config/context loaded internally
  - submit(prompt, displayInput?, rawInput?)
  - abort(), cancelQueue()
  - executeCommand(name, args) ← embedded SystemCommandExecutor
  - on/off events (text_delta, tool_start, tool_end, thinking, complete, interrupted, error)
  - getMessages(), getContextState(), isExecuting(), getPendingPrompt(), getActiveTools()
- createQuery({ provider }) — factory that returns a prompt-only convenience function
- ISystemCommand, ICommandResult, ICommand, ICommandSource
- CommandRegistry, BuiltinCommandSource, SkillCommandSource, PluginCommandSource
- TInteractivePermissionHandler (SDK-owned permission callback type)
- Plugin management: BundlePluginLoader, BundlePluginInstaller, PluginSettingsStore, MarketplaceClient

Internal (not exported):

- createSession() — assembly factory
- createDefaultTools() — tool assembly
- loadConfig(), loadContext() — config/context loading
- createProvider() — removed (provider comes from consumer)

### agent-cli

Role: Terminal TUI product

Owns:

- Provider creation (reads config → picks provider package → creates instance)
- Ink components: App, MessageList, InputArea, StreamingIndicator, StatusBar, etc.
- useInteractiveSession hook (SDK event → React state bridge)
- Slash prefix parsing (/ → session.executeCommand())
- Terminal-specific: CjkTextInput, bracketed paste, multiline navigation, WaveText
- CLI utilities: settings-io, paste-labels, edit-diff, cli-args

### agent-transport-\*

Role: Protocol adapters (library)

Owns:

- transport-http: createAgentRoutes({ sessionFactory }) — Hono router
- transport-mcp: createAgentMcpServer({ session }) — MCP server
- transport-ws: createWsHandler({ session, send }) — WebSocket handler

## Import Rules

### CLI import rules

| Source            | Allowed                       | Examples                                                              |
| ----------------- | ----------------------------- | --------------------------------------------------------------------- |
| agent-sdk         | SDK-owned APIs                | InteractiveSession, TInteractivePermissionHandler                     |
| agent-core        | Public types + utilities only | TUniversalMessage, TPermissionMode, createSystemMessage, getModelName |
| agent-core        | ❌ Internal engine            | ~~Robota~~, ~~ExecutionService~~, ~~ConversationStore~~               |
| agent-sessions    | ❌ Forbidden                  | SDK provides its own types                                            |
| agent-tools       | ❌ Forbidden                  | SDK assembles tools internally                                        |
| agent-provider-\* | ✅ Provider creation          | AnthropicProvider, GoogleProvider (CLI picks which to use)            |

### SDK import rules

| Source            | Allowed                         |
| ----------------- | ------------------------------- |
| agent-core        | Full access                     |
| agent-sessions    | Full access                     |
| agent-tools       | Full access                     |
| agent-provider-\* | ❌ Forbidden (provider-neutral) |

### Transport import rules

| Source     | Allowed                                              |
| ---------- | ---------------------------------------------------- |
| agent-sdk  | InteractiveSession and related types                 |
| agent-core | Public types only (TUniversalMessage etc. if needed) |

## Changes Required

### SDK changes

1. Remove agent-provider-anthropic from dependencies
2. Remove createProvider() — provider comes from consumer
3. Embed SystemCommandExecutor into InteractiveSession (session.executeCommand())
4. Move PluginCommandSource from CLI to SDK
5. Make createSession() internal (unexport)
6. Make loadConfig(), loadContext() internal (called by InteractiveSession constructor)
7. InteractiveSession constructor: { cwd, provider } — config/context loaded internally
8. Replace query() with createQuery({ provider }) factory pattern
9. Define TInteractivePermissionHandler as SDK-owned type (no sessions import needed by consumers)
10. Make createDefaultTools() internal (unexport)

### CLI changes

1. Add agent-provider-anthropic (and others) as direct dependency
2. Create provider based on config, pass to InteractiveSession
3. Remove SystemCommandExecutor usage — use session.executeCommand()
4. Remove PluginCommandSource (moved to SDK)
5. Remove all agent-sessions imports — use SDK types
6. Simplify InteractiveSession creation: just cwd + provider

### Transport changes

1. Remove commandExecutor from options
2. Route command requests through session.executeCommand()

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
