# Sessions Specification

## Scope

Owns session and chat management behavior for the Robota SDK. This package provides multi-session support with independent workspace isolation, chat instance lifecycle management, and agent template integration. It acts as the orchestration layer between consumer code and `@robota-sdk/agent-core`, giving each session its own set of chat instances backed by `Robota` agent instances.

## Boundaries

- Does not own provider-specific transport behavior. All AI provider interactions are delegated to `@robota-sdk/agent-core` via `Robota` instances.
- Does not own conversation history storage. Re-exports `ConversationHistory` and `ConversationSession` from `@robota-sdk/agent-core`.
- Does not own agent configuration types (`IAgentConfig`, `TUniversalMessage`, `IRunOptions`, `IAgent`). These are re-exported from `@robota-sdk/agent-core` as the SSOT.
- Does not own agent template definitions (`IAgentTemplate`, `AgentTemplates`). Adapts them through `TemplateManagerAdapter`.
- Keeps session lifecycle, workspace isolation, and chat-level state management explicit within this package.
- Persistence (`save`/`load` on `ChatInstance`) is declared but not yet implemented.

## Architecture Overview

The package follows a three-layer structure:

```
types/          -- Domain contracts (interfaces, enums, type aliases)
session/        -- SessionManager: top-level orchestrator for sessions and chats
chat/           -- ChatInstance: single chat wrapper around a Robota agent
adapters/       -- TemplateManagerAdapter: bridges agents template system to sessions interface
```

**Design patterns used:**

- **Adapter pattern** -- `TemplateManagerAdapter` adapts `AgentFactory` and `AgentTemplates` from `@robota-sdk/agent-core` to the local `ITemplateManager` interface.
- **Facade pattern** -- `SessionManager` provides a single entry point for creating sessions, creating chats, switching active chats, and querying session/chat state.
- **Delegation** -- `ChatInstance` delegates all AI execution (`run`, `getHistory`, `clearHistory`, `configure`) to the underlying `Robota` instance.
- **Factory delegation** -- `SessionManager` uses `AgentFactory` from `@robota-sdk/agent-core` to create `Robota` instances for each chat.

**Dependency direction:** `@robota-sdk/agent-sessions` depends on `@robota-sdk/agent-core`. No reverse dependency exists.

## Type Ownership

Types owned by this package (SSOT):

| Type                    | Kind       | File            | Description                                                              |
| ----------------------- | ---------- | --------------- | ------------------------------------------------------------------------ |
| `SessionState`          | Enum       | `types/core.ts` | Session lifecycle states: `ACTIVE`, `PAUSED`, `TERMINATED`               |
| `ISessionConfig`        | Interface  | `types/core.ts` | Session configuration (name, maxChats, userId, workspaceId)              |
| `ISessionInfo`          | Interface  | `types/core.ts` | Session runtime information and metadata                                 |
| `IChatInfo`             | Interface  | `types/core.ts` | Summary information for a chat within a session                          |
| `ISessionManagerConfig` | Interface  | `types/core.ts` | Manager-level configuration (maxSessions, maxChatsPerSession)            |
| `ICreateSessionOptions` | Interface  | `types/core.ts` | Options for creating a new session                                       |
| `ICreateChatOptions`    | Interface  | `types/core.ts` | Options for creating a new chat (requires `agentConfig`)                 |
| `TMessageContent`       | Type alias | `types/chat.ts` | Message content type (currently `string`)                                |
| `IChatConfig`           | Interface  | `types/chat.ts` | Chat-level configuration (robotaConfig, agentTemplate, description)      |
| `IChatMetadata`         | Interface  | `types/chat.ts` | Chat metadata (id, timestamps, messageCount, isActive)                   |
| `IChatStats`            | Interface  | `types/chat.ts` | Chat statistics (messageCount, timestamps, optional token/timing)        |
| `ITemplateManager`      | Interface  | `types/chat.ts` | Template manager contract (getTemplate, listTemplates, validateTemplate) |
| `IChatInstance`         | Interface  | `types/chat.ts` | Full chat instance contract (not exported publicly)                      |

Types re-exported from `@robota-sdk/agent-core` (not owned here):

| Type                  | Source                   |
| --------------------- | ------------------------ |
| `IAgent`              | `@robota-sdk/agent-core` |
| `IAgentConfig`        | `@robota-sdk/agent-core` |
| `TUniversalMessage`   | `@robota-sdk/agent-core` |
| `IRunOptions`         | `@robota-sdk/agent-core` |
| `ConversationHistory` | `@robota-sdk/agent-core` |
| `ConversationSession` | `@robota-sdk/agent-core` |

## Public API Surface

| Export                   | Kind                   | Description                                                                                    |
| ------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------- |
| `SessionManager`         | Class                  | Top-level manager: creates/deletes sessions, creates/deletes/switches chats, enforces limits   |
| `ChatInstance`           | Class                  | Wraps a `Robota` instance with session-scoped metadata, activation state, and template support |
| `TemplateManagerAdapter` | Class                  | Adapts `AgentFactory`/`AgentTemplates` from agents package to `ITemplateManager`               |
| `ConversationHistory`    | Class (re-export)      | Re-exported from `@robota-sdk/agent-core`                                                      |
| `ConversationSession`    | Class (re-export)      | Re-exported from `@robota-sdk/agent-core`                                                      |
| `SessionState`           | Enum (via type export) | Exported through `types/core.ts` re-export                                                     |
| `ITemplateManager`       | Interface              | Template manager contract                                                                      |
| `IChatConfig`            | Interface              | Chat configuration                                                                             |
| `IChatMetadata`          | Interface              | Chat metadata                                                                                  |
| `IChatStats`             | Interface              | Chat statistics                                                                                |
| `TMessageContent`        | Type alias             | Message content type                                                                           |
| `ISessionConfig`         | Interface              | Session configuration                                                                          |
| `ISessionInfo`           | Interface              | Session runtime info                                                                           |
| `IChatInfo`              | Interface              | Chat summary info                                                                              |
| `ISessionManagerConfig`  | Interface              | Manager configuration                                                                          |
| `ICreateSessionOptions`  | Interface              | Session creation options                                                                       |
| `ICreateChatOptions`     | Interface              | Chat creation options                                                                          |
| `IAgent`                 | Interface (re-export)  | From `@robota-sdk/agent-core`                                                                  |
| `IAgentConfig`           | Interface (re-export)  | From `@robota-sdk/agent-core`                                                                  |
| `TUniversalMessage`      | Type alias (re-export) | From `@robota-sdk/agent-core`                                                                  |
| `IRunOptions`            | Interface (re-export)  | From `@robota-sdk/agent-core`                                                                  |

### Key SessionManager Methods

| Method            | Signature                                                             | Description                                                      |
| ----------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `createSession`   | `(options?: ICreateSessionOptions) => string`                         | Creates a session, returns session ID. Throws on limit exceeded. |
| `getSession`      | `(sessionId: string) => ISessionInfo \| undefined`                    | Retrieves session info by ID.                                    |
| `listSessions`    | `() => ISessionInfo[]`                                                | Lists all sessions.                                              |
| `deleteSession`   | `(sessionId: string) => boolean`                                      | Deletes session and all its chats.                               |
| `createChat`      | `(sessionId: string, options: ICreateChatOptions) => Promise<string>` | Creates a chat with a new `Robota` instance via `AgentFactory`.  |
| `getChat`         | `(chatId: string) => ChatInstance \| undefined`                       | Retrieves a chat instance by ID.                                 |
| `getSessionChats` | `(sessionId: string) => IChatInfo[]`                                  | Lists all chats in a session.                                    |
| `switchChat`      | `(sessionId: string, chatId: string) => boolean`                      | Deactivates current active chat, activates the target chat.      |
| `deleteChat`      | `(chatId: string) => boolean`                                         | Deletes a chat and updates session state.                        |

### Key ChatInstance Methods

| Method                        | Signature                                       | Description                                             |
| ----------------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| `sendMessage`                 | `(content: TMessageContent) => Promise<string>` | Sends message via `robota.run()`, updates metadata.     |
| `regenerateResponse`          | `() => Promise<string>`                         | Re-sends the last user message.                         |
| `updateRobotaConfig`          | `(config: IAgentConfig) => Promise<void>`       | Updates the underlying Robota configuration.            |
| `getRobotaConfig`             | `() => IAgentConfig`                            | Returns current agent config.                           |
| `upgradeToTemplate`           | `(templateName: string) => Promise<void>`       | Applies an agent template via `TemplateManagerAdapter`. |
| `activate` / `deactivate`     | `() => void`                                    | Toggles active state in metadata.                       |
| `getHistory` / `clearHistory` | `() => TUniversalMessage[]` / `() => void`      | Delegates to `Robota` history management.               |
| `getStats`                    | `() => IChatStats`                              | Returns chat statistics.                                |
| `save` / `load`               | `() => Promise<void>`                           | Not yet implemented. Throws on call.                    |

## Extension Points

1. **ITemplateManager interface** -- Consumers can provide a custom template manager implementation. The default `TemplateManagerAdapter` bridges to the agents package, but the `ITemplateManager` interface allows replacement.

2. **TemplateManagerAdapter.registerTemplate / unregisterTemplate** -- Consumers can register custom `IAgentTemplate` instances at runtime to extend available templates.

3. **TemplateManagerAdapter.applyTemplate** -- Consumers can apply a template with partial overrides to derive customized agent configurations.

4. **ICreateChatOptions.agentConfig** -- Each chat creation accepts a full `IAgentConfig`, allowing consumers to configure provider, model, system prompt, and other agent parameters per chat.

5. **ISessionManagerConfig** -- Consumers control session and chat limits through the manager configuration.

## Error Taxonomy

This package does not define a custom error hierarchy. All errors are thrown as standard `Error` instances with descriptive messages. Error scenarios include:

| Error Condition                  | Thrown By                                 | Message Pattern                                                                 |
| -------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| Session limit exceeded           | `SessionManager.createSession`            | `"Maximum sessions limit (N) reached..."`                                       |
| Session not found                | `SessionManager.createChat`               | `"Session {id} not found"`                                                      |
| Chat limit exceeded              | `SessionManager.createChat`               | `"Maximum chats per session (N) reached"`                                       |
| Message send failure             | `ChatInstance.sendMessage`                | `"Failed to send message: {cause}"`                                             |
| No user message for regeneration | `ChatInstance.regenerateResponse`         | `"No user message found to regenerate response for"`                            |
| Template not found               | `ChatInstance.upgradeToTemplate`          | `"Template '{name}' not found"`                                                 |
| Config update failure            | `ChatInstance.updateRobotaConfig`         | `"Failed to update robota config: {cause}"`                                     |
| Persistence not implemented      | `ChatInstance.save` / `ChatInstance.load` | `"Chat persistence not yet implemented"` / `"Chat loading not yet implemented"` |

Underlying AI provider errors propagate from `@robota-sdk/agent-core` and are wrapped in the message send/config update error paths.

## Class Contract Registry

### Interface Implementations

| Interface          | Implementor              | Kind                 | Location                                   |
| ------------------ | ------------------------ | -------------------- | ------------------------------------------ |
| `IChatInstance`    | `ChatInstance`           | production           | `src/chat/chat-instance.ts`                |
| `ITemplateManager` | `TemplateManagerAdapter` | production (adapter) | `src/adapters/template-manager-adapter.ts` |

### Inheritance Chains

None. Classes are standalone.

### Cross-Package Port Consumers

| Port (Owner)              | Consumer Class           | Location                                   |
| ------------------------- | ------------------------ | ------------------------------------------ |
| `Robota` (agents)         | `ChatInstance`           | `src/chat/chat-instance.ts`                |
| `AgentFactory` (agents)   | `SessionManager`         | `src/session/session-manager.ts`           |
| `AgentTemplates` (agents) | `TemplateManagerAdapter` | `src/adapters/template-manager-adapter.ts` |

## Test Strategy

### Current Test Coverage

| File                                  | Scope | Description                                                                                 |
| ------------------------------------- | ----- | ------------------------------------------------------------------------------------------- |
| `src/session/session-manager.test.ts` | Unit  | Tests session CRUD, session limit enforcement, chat creation structure, workspace isolation |

### Test Characteristics

- Uses `vitest` as the test runner.
- Session management tests are fully synchronous and self-contained.
- Chat creation tests use `try/catch` to handle expected failures when AI providers are not configured (no mock providers injected).
- No integration tests with real AI providers.

### Gaps

- **ChatInstance** -- No dedicated unit tests. `sendMessage`, `regenerateResponse`, `updateRobotaConfig`, `upgradeToTemplate`, `activate`/`deactivate`, `getHistory`, `clearHistory`, `getStats`, and `updateConfig` are untested.
- **TemplateManagerAdapter** -- No unit tests for template lookup, listing, validation, registration, or `applyTemplate`.
- **Chat switching** -- `switchChat` is not covered in the existing test suite.
- **Chat deletion** -- `deleteChat` is not covered.
- **Session deletion cascade** -- Verifying that all child chats are cleaned up when a session is deleted.
- **Type import correctness** -- The test file imports `CreateSessionOptions` and `CreateChatOptions` (without `I` prefix), which may not match the actual exported type names (`ICreateSessionOptions`, `ICreateChatOptions`). This could indicate the test file is out of date or does not pass type checking.
- **Persistence stubs** -- `save`/`load` throw errors by design; no tests verify this behavior.
