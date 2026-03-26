# @robota-sdk/agent-sdk SPEC

## Overview

Robota SDK is a programming SDK built by **assembling** existing Robota packages.
It is provider-neutral: the consumer (CLI, server, worker, etc.) creates the provider and passes it to the SDK.
The primary entry point is `InteractiveSession({ cwd, provider })`. A `createQuery({ provider })` factory is also provided for single-shot prompt use.

## Core Principles

1. **Assembly first**: All features are implemented using existing packages. Independent implementation is prohibited.
2. **No duplication**: If the same functionality exists in an existing package, use it. Refactor the existing package if needed.
3. **Connection required**: All features in agent-sdk must be connected to the Robota package ecosystem.
4. **General/specialized separation**: General-purpose features (permissions, hooks, tools) belong in their respective packages; only SDK-specific features (config, context) are kept in agent-sdk.

## Architecture

### Package Dependency Chain

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
  └── NO provider dependency (provider-neutral)

agent-cli            ← minimal TUI
  ├── creates provider (reads config, picks provider package)
  ├── creates InteractiveSession({ cwd, provider })
  ├── subscribes to events → renders to terminal
  └── owns: slash prefix parsing, Ink components, paste handling, CJK input
```

SDK is provider-neutral. The consumer (CLI, server, etc.) creates the provider and passes it to the SDK. Assembly (wiring tools, provider, system prompt) happens inside the SDK, but the provider itself comes from the consumer.

### Client–SDK–Session Relationship

```
Any client (CLI, web, API server, worker)
    │
    │  1. creates provider:  new AnthropicProvider({ apiKey })
    │  2. creates session:   new InteractiveSession({ cwd, provider })
    │  3. subscribes:        session.on('text_delta', ...)
    ↓
InteractiveSession  (agent-sdk — pure TypeScript, no React)
    │  submit(input, displayInput?, rawInput?)
    │  executeCommand(name, args)
    │  abort() / cancelQueue()
    │  getMessages() / getContextState() / getActiveTools()
    │  (config/context loaded internally from cwd)
    ↓
Session  (agent-sessions — generic run loop)
    ↓
Robota engine + Provider  (agent-core / agent-provider-*)

agent-cli (Ink TUI — thin bridge layer)
    creates provider → passes to InteractiveSession({ cwd, provider })
    subscribes to InteractiveSession events → maps to React/Ink state
    routes /commands → session.executeCommand()
```

The SDK layer has **no React dependency** and **no provider dependency**. The CLI is a TUI-only layer that creates the provider and bridges InteractiveSession events to React state.

### Package Roles

| Package               | Role                                                                                                       | General/Specialized |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------- |
| **agent-core**        | Robota engine, execution loop, provider abstraction, permissions, hooks                                    | General             |
| **agent-tools**       | Tool creation infrastructure + 8 built-in tools                                                            | General             |
| **agent-sessions**    | Generic Session class, SessionStore (persistence)                                                          | General             |
| **agent-sdk**         | Assembly layer: InteractiveSession (single entry point), embedded commands, createQuery(), config, context | SDK-specific        |
| **agent-cli**         | Ink TUI (terminal UI). Creates provider, passes to InteractiveSession. No agent-sessions import.           | CLI-specific        |
| **agent-provider-\*** | AI provider implementations. CLI depends on these directly; SDK does not.                                  | Provider-specific   |

### Feature Layout (Current Implementation State)

```
agent-core
├── src/permissions/          ← permission-gate, permission-mode, types
├── src/hooks/                ← hook-runner, hook types
└── (existing) Robota, execution, providers, plugins

agent-tools
├── src/builtins/             ← bash, read, write, edit, glob, grep, web-fetch, web-search tools
├── src/types/tool-result.ts  ← TToolResult
└── (existing) FunctionTool, createZodFunctionTool, schema conversion

agent-sessions (generic — depends only on agent-core)
├── src/session.ts                ← Session: orchestrates run loop, delegates to sub-components
├── src/permission-enforcer.ts    ← PermissionEnforcer: tool wrapping, permission checks, hooks, truncation
├── src/context-window-tracker.ts ← ContextWindowTracker: token usage, auto-compact threshold
├── src/compaction-orchestrator.ts ← CompactionOrchestrator: conversation summarization via LLM
├── src/session-logger.ts         ← ISessionLogger + FileSessionLogger / SilentSessionLogger
├── src/session-store.ts          ← SessionStore (JSON file persistence)
└── src/index.ts

agent-sdk (assembly layer — SDK-specific features only)
├── src/interactive/
│   ├── interactive-session.ts  ← InteractiveSession: event-driven wrapper over Session
│   └── types.ts                ← IToolState, IExecutionResult, IInteractiveSessionEvents
├── src/commands/
│   ├── command-registry.ts     ← CommandRegistry: aggregates ICommandSource instances
│   ├── builtin-source.ts       ← BuiltinCommandSource: built-in commands
│   ├── skill-source.ts         ← SkillCommandSource: discovers SKILL.md files
│   ├── plugin-source.ts        ← PluginCommandSource: discovers plugin commands (moved from agent-cli)
│   ├── system-command.ts       ← SystemCommandExecutor + ISystemCommand + createSystemCommands() (internal)
│   └── types.ts                ← ICommand, ICommandSource
├── src/assembly/               ← Session factory: createSession (internal), createDefaultTools (internal)
├── src/config/                 ← settings.json loading (6-layer merge, $ENV substitution)
├── src/context/                ← AGENTS.md/CLAUDE.md walk-up discovery, project detection, system prompt
├── src/tools/agent-tool.ts     ← Agent sub-session tool (SDK-specific: uses createSession)
├── src/permissions/            ← permission-prompt.ts (terminal approval prompt)
├── src/paths.ts                ← projectPaths / userPaths helpers
├── src/types.ts                ← re-exports shared types from agent-sessions
├── src/query.ts                ← createQuery() factory (provider-neutral; provider injected by consumer)
└── src/index.ts                ← assembly exports + re-exports from agent-sessions/tools/core

agent-cli (Ink TUI — CLI-specific)
├── src/commands/               ← Re-exports CommandRegistry from agent-sdk;
│                                  skill-executor, slash-executor (CLI-specific execution wrappers)
├── src/ui/                     ← App, MessageList, InputArea, StatusBar, PermissionPrompt,
│                                  SlashAutocomplete, CjkTextInput, WaveText, InkTerminal, render
├── src/permissions/            ← permission-prompt.ts (terminal arrow-key selection)
├── src/types.ts                ← ITerminalOutput, ISpinner (duplicate — SSOT is agent-sessions)
├── src/cli.ts                  ← CLI argument parsing, Ink render
└── src/bin.ts                  ← Binary entry point
```

## Feature Details

### Session Management

- **Package**: `agent-sessions` (generic, depends only on agent-core)
- **Implementation**: Session accepts pre-constructed tools, provider, and system message. Internal concerns are delegated to PermissionEnforcer, ContextWindowTracker, and CompactionOrchestrator.
- **Assembly**: `agent-sdk/assembly/` provides `createSession()` (internal — not exported) which wires tools, provider, and system prompt from config/context. Consumers use `InteractiveSession({ cwd, provider })` instead.
- **Persistence**: SessionStore saves/loads/lists/deletes JSON at `~/.robota/sessions/{id}.json`

### Permission System

- **Package**: `agent-core` (general-purpose security layer)
- **Implementation**: 3-step evaluation — deny list → allow list → mode policy
- **Modes**: `plan` (read-only), `default` (write requires approval), `acceptEdits` (write auto-approved), `bypassPermissions` (all auto-approved)
- **Pattern syntax**: `Bash(pnpm *)`, `Read(/src/**)`, `Write(*)` etc. with glob matching
- **Terminal prompt**: `agent-sdk/src/permissions/permission-prompt.ts` is the SSOT implementation of the terminal approval prompt. Used by both `InteractiveSession`/`createQuery()` and `agent-cli` (which imports from `@robota-sdk/agent-sdk`).
- **Default allow patterns**: `createSession()` automatically adds allow patterns for config folder access: `Read(.agents/**)`, `Read(.claude/**)`, `Read(.robota/**)`, `Glob(.agents/**)`, `Glob(.claude/**)`, `Glob(.robota/**)`. These are merged with user-configured permissions.

### Hooks System

- **Package**: `agent-core` (general-purpose extension points)
- **Events**: `PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `Stop`
- **Implementation**: Executes shell commands, passes JSON via stdin, determines allow(0)/deny(2) by exit code
- **Matcher**: Tool name regex pattern matching

### Tool System

- **Infrastructure**: `agent-tools` (createZodFunctionTool, FunctionTool, Zod→JSON conversion)
- **Built-in tools**: `agent-tools/builtins/` — Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch
- **Agent tool**: `agent-sdk/tools/agent-tool.ts` — sub-agent Session creation (SDK-specific)
- **Tool result type**: `TToolResult` in `agent-tools/types/tool-result.ts`

### Web Search

- **Implementation**: Anthropic server tool (`web_search_20250305`), not a `FunctionTool`
- **Behavior**: Enabled automatically when the provider is Anthropic. The system prompt includes an instruction that the agent must use `web_search` when the user asks to search the web.
- **Activation**: `enableWebTools` is set as a property on the AnthropicProvider instance by `Session.configureProvider()`. No tool registration is required because the tool is server-managed.
- **Callback**: `onServerToolUse` fires during streaming when the server tool executes, allowing the UI to display search status.

### Streaming

- **Implementation**: `TTextDeltaCallback` type (IChatOptions in agent-core)
- **Behavior**: AnthropicProvider uses the streaming API, returning the completed message while calling the callback for each text delta
- **UI connection**: Session → onTextDelta → InteractiveSession `text_delta` event → client

### InteractiveSession (SDK-Specific)

- **Package**: `agent-sdk/interactive/`
- **Pattern**: Composition over Session (holds a `Session` instance, does not extend it)
- **Constructor**: Accepts `{ cwd, provider }` only. Config and context are loaded internally from `cwd`.
- **Responsibility**: Streaming accumulation, tool state tracking, prompt queue (max 1), abort orchestration, full history management (`IHistoryEntry[]`), embedded command execution
- **Tool execution history**: Each `tool_start` and `tool_end` event is recorded as an individual `IHistoryEntry` with `category: 'event'` and `type: 'tool-start'` or `type: 'tool-end'`. Data includes `toolName`, `firstArg`, `isRunning`, and `result`. The `tool-summary` entry (aggregated) is still pushed at execution completion for backward compatibility.
- **Events**: `text_delta`, `tool_start`, `tool_end`, `thinking`, `complete`, `error`, `context_update`, `interrupted`
- **submit() signature**: `submit(input, displayInput?, rawInput?)` — `displayInput` overrides what appears in the client's message list; `rawInput` is passed to `Session.run()` for hook matching
- **executeCommand()**: `executeCommand(name, args)` — executes a named system command via the embedded `SystemCommandExecutor`. Replaces direct `SystemCommandExecutor` usage by consumers.
- **listCommands()**: `listCommands()` — returns `Array<{ name, description }>` of all registered system commands. Used by transport adapters (e.g., MCP) to expose commands as tools.
- **Queue behavior**: If `executing` is true, the incoming prompt is queued. The queued prompt auto-executes after the current one completes. Only one prompt can be queued at a time.
- **Abort**: `abort()` clears the queue and delegates to `session.abort()`. An `interrupted` event fires when the abort completes.
- **No-op terminal**: Uses a built-in NOOP_TERMINAL so no `ITerminalOutput` implementation is required by callers
- **Session persistence**: When `sessionStore` is provided in options, auto-persists session state (messages, history, cwd, timestamps) to disk after each `submit()` completion. Uses `SessionStore` from `agent-sessions`.
- **Session restore**: When `resumeSessionId` is provided, loads the saved session record and restores AI context. Messages are stored as `pendingRestoreMessages` and injected via `session.injectMessage()` after async initialization completes (deferred injection pattern). This avoids injection failures caused by the Session not yet being fully initialized when the constructor runs.
- **forkSession option**: `forkSession?: boolean` (default `false`). When `false` (resume), the original session ID is passed to the Session constructor so it reuses the same file. When `true` (fork), `sessionId` is omitted, generating a fresh UUID — the original session remains untouched.
- **getName()/setName(name)**: Get or set the session's user-facing name. Persists to the session record when a store is configured.
- **attachTransport(transport)**: `attachTransport(transport: ITransportAdapter)` — attaches a transport adapter to this session. Calls `transport.attach(this)`. Used by consumers to compose transports consistently: `session.attachTransport(transport); await transport.start();`
- **Testing**: Accepts an optional pre-built `Session` via `options.session` to enable unit testing without I/O setup

### System Command System (SDK-Specific)

- **Package**: `agent-sdk/commands/`
- **Purpose**: SDK-level command execution logic — pure TypeScript, no React, no TUI dependency
- **Embedding**: `SystemCommandExecutor` is embedded inside `InteractiveSession`. Consumers call `session.executeCommand(name, args)` directly. `SystemCommandExecutor` is not independently exported.
- **Classes**:
  - `SystemCommandExecutor` — registry + executor for `ISystemCommand` instances (internal to InteractiveSession)
  - `createSystemCommands()` — factory for all built-in commands (internal)
- **Design**: Commands return `ICommandResult` with `message`, `success`, and optional `data`. Side effects that require caller context (file I/O for `reset`, model switching for `model`) are signaled via `data` — the caller applies them.
- **Built-in commands**: `help`, `clear`, `compact`, `mode`, `model`, `language`, `cost`, `context`, `permissions`, `resume`, `rename`, `reset`

### Slash Command Registry (SDK-Specific)

- **Package**: `agent-sdk/commands/` — SSOT owner; agent-cli re-exports from here
- **Classes**:
  - `CommandRegistry` — aggregates multiple `ICommandSource` instances; filters by prefix; resolves plugin-qualified names
  - `BuiltinCommandSource` — provides built-in slash commands with subcommand trees (mode, model, language)
  - `SkillCommandSource` — discovers SKILL.md files from project and user directories; parses YAML frontmatter; lazy-caches results
  - `PluginCommandSource` — discovers commands exposed by installed bundle plugins (moved from agent-cli to agent-sdk)
- **Migration note**: These classes were previously in `agent-cli/src/commands/`. They were moved to `agent-sdk` so any client can use slash command discovery without a TUI dependency. `PluginCommandSource` was also moved from `agent-cli` to `agent-sdk` as part of the scope redesign.

### Config Loading (SDK-Specific)

- **Package**: `agent-sdk/config/`
- **Rationale**: `.robota/settings.json` file-based configuration is for local development environments only (servers use environment variables/DB)
- **Implementation**: 3-layer merge (user global → project → local), `$ENV:VAR` substitution, Zod validation

### Context Loading (SDK-Specific)

- **Package**: `agent-sdk/context/`
- **Rationale**: AGENTS.md/CLAUDE.md walk-up discovery is for local development environments only
- **Implementation**: Directory traversal from cwd to root, project type/language detection, system prompt assembly
- **Response Language**: `IResolvedConfig.language` (from settings.json `language` field) is injected into the system prompt via `buildSystemPrompt()`. Persists across compaction because system message is preserved.
- **Compact Instructions**: Extracts "Compact Instructions" section from CLAUDE.md and passes to Session for compaction
- **Skill Discovery Paths**: Skills are discovered from `.agents/skills/*/SKILL.md` (project) and `~/.robota/skills/*/SKILL.md` (user). Used by agent-cli's `SkillCommandSource` for slash command autocomplete

### Context Window Management

- **Token tracking**: `agent-sessions` Session tracks cumulative input tokens from provider response metadata
- **Usage state**: `session.getContextState()` returns `IContextWindowState` (usedTokens, maxTokens, usedPercentage)
- **Auto-compaction**: Triggers at ~83.5% of model context window (configurable per model)
- **Manual compaction**: `session.compact(instructions?)` generates LLM summary, replaces history
- **Model sizes**: Lookup table per model (200K for Sonnet/Haiku, 1M for Opus)
- **Compact Instructions**: Extracted from CLAUDE.md "Compact Instructions" section, passed to summary prompt
- **Hooks**: PreCompact/PostCompact events in agent-core, fired before/after compaction
- **Callbacks**: `onCompact` in `createQuery()` options for notification when compaction occurs

## Public API

### InteractiveSession — Central Client-Facing API

Wraps `Session` (composition) to provide event-driven interaction for any client (CLI, web, API server, worker). Manages streaming text accumulation, tool execution state tracking, prompt queuing, abort orchestration, and message history. Logic previously embedded in CLI React hooks.

The SDK is pure TypeScript with no React dependency. The CLI is a thin TUI-only layer that subscribes to `InteractiveSession` events and maps them to React/Ink state.

```typescript
import { InteractiveSession } from '@robota-sdk/agent-sdk';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

// Consumer creates provider and passes it to InteractiveSession.
// Config and context are loaded internally from cwd.
const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const session = new InteractiveSession({ cwd: process.cwd(), provider });

// Event-driven — subscribe to state changes
session.on('text_delta', (delta: string) => { /* streaming text chunk */ });
session.on('tool_start', (state: IToolState) => { /* tool execution began */ });
session.on('tool_end', (state: IToolState) => { /* tool execution finished */ });
session.on('thinking', (isThinking: boolean) => { /* execution state changed */ });
session.on('complete', (result: IExecutionResult) => { /* prompt completed */ });
session.on('error', (error: Error) => { /* execution error */ });
session.on('context_update', (state: IContextWindowState) => { /* token usage updated */ });
session.on('interrupted', (result: IExecutionResult) => { /* abort completed */ });

// Submit prompt. Queues if already executing (max 1 queued).
// displayInput: shown in UI (e.g., "/audit") instead of full built prompt
// rawInput: passed to Session.run() for hook matching
await session.submit(input, displayInput?, rawInput?);

// Execute a named system command (embedded SystemCommandExecutor)
const result = await session.executeCommand('context', '');
// result.message — human-readable string
// result.success — boolean
// result.data   — command-specific structured data

// List all registered system commands (for transport adapters)
const commands = session.listCommands(); // Array<{ name, description }>

// Abort current execution and clear queue
session.abort();

// Cancel queued prompt without aborting current execution
session.cancelQueue();

// State queries
session.isExecuting();       // boolean
session.getPendingPrompt();  // string | null
session.getMessages();       // TUniversalMessage[] — backward-compatible; returns chat entries only
session.getFullHistory();    // IHistoryEntry[] — full history including event entries (tool summaries, skill invocations)
session.getContextState();   // IContextWindowState
session.getStreamingText();  // string (accumulated so far)
session.getActiveTools();    // IToolState[]
```

**IToolState:**

```typescript
interface IToolState {
  toolName: string;
  firstArg: string;
  isRunning: boolean;
  result?: 'success' | 'error' | 'denied';
  diffLines?: IDiffLine[];
  diffFile?: string;
}
```

**IExecutionResult:**

```typescript
interface IExecutionResult {
  response: string;
  history: IHistoryEntry[]; // Full history including chat + event entries
  toolSummaries: IToolSummary[];
  contextState: IContextWindowState;
}
```

**IInteractiveSessionEvents:**

```typescript
interface IInteractiveSessionEvents {
  text_delta: (delta: string) => void;
  tool_start: (state: IToolState) => void;
  tool_end: (state: IToolState) => void;
  thinking: (isThinking: boolean) => void;
  complete: (result: IExecutionResult) => void;
  error: (error: Error) => void;
  context_update: (state: IContextWindowState) => void;
  interrupted: (result: IExecutionResult) => void;
}
```

**ITransportAdapter:**

```typescript
interface ITransportAdapter {
  /** Human-readable transport name (e.g., 'http', 'ws', 'mcp', 'headless') */
  readonly name: string;

  /** Attach an InteractiveSession to this transport. */
  attach(session: InteractiveSession): void;

  /** Start serving. What this means depends on the transport. */
  start(): Promise<void>;

  /** Stop serving and clean up resources. */
  stop(): Promise<void>;
}
```

Common interface for all transport adapters. Defined in `src/interactive/types.ts` and exported from `@robota-sdk/agent-sdk`. Each `agent-transport-*` package provides a factory that returns an `ITransportAdapter` implementation.

### History Entry Types

`InteractiveSession` manages history as `IHistoryEntry[]`. Each entry has a `category` field:

| Category  | Description                                                                                 |
| --------- | ------------------------------------------------------------------------------------------- |
| `'chat'`  | A standard conversation message (`TUniversalMessage`). Returned by `getMessages()` as-is.   |
| `'event'` | A structured non-message event (tool summary, skill invocation, system notification, etc.). |

**Tool summary entry** (appended by `InteractiveSession` after each execution round):

```typescript
// category: 'event', type: 'tool-summary'
{
  id: string;
  timestamp: Date;
  category: 'event';
  type: 'tool-summary';
  data: { toolSummaries: IToolSummary[] };
}
```

**Skill invocation entry** (appended by `InteractiveSession` when a skill slash command is executed):

```typescript
// category: 'event', type: 'skill-invocation'
{
  id: string;
  timestamp: Date;
  category: 'event';
  type: 'skill-invocation';
  data: {
    skillName: string;
    displayInput: string;
  }
}
```

Consumers that need only AI messages call `getMessages()` (returns `TUniversalMessage[]` — backward-compatible). Consumers that need the full picture (e.g., rendering a rich message list) call `getFullHistory()` (returns `IHistoryEntry[]`).

### System Commands — Embedded in InteractiveSession

`SystemCommandExecutor` is embedded inside `InteractiveSession` and is **not independently exported**. Consumers access system commands via `session.executeCommand(name, args)`.

The command types and result interface are exported for consumers that need to inspect results:

```typescript
import type { ICommandResult, ISystemCommand } from '@robota-sdk/agent-sdk';

// Execute a named command on the session (returns null if command not found)
const result: ICommandResult | null = await session.executeCommand('context', '');
// result.message — human-readable string
// result.success — boolean
// result.data   — command-specific structured data
```

**Built-in commands:**

| Command       | Description                                                                           |
| ------------- | ------------------------------------------------------------------------------------- |
| `help`        | Show available commands                                                               |
| `clear`       | Clear conversation history                                                            |
| `compact`     | Compress context window (optional focus instructions)                                 |
| `mode [m]`    | Show or change permission mode                                                        |
| `model <id>`  | Change AI model (returns `data.modelId` — caller applies)                             |
| `language`    | Set response language (returns `data.language`)                                       |
| `cost`        | Session ID and message count                                                          |
| `context`     | Token usage: used / max / percentage                                                  |
| `permissions` | Current mode and session-approved tools                                               |
| `reset`       | Returns `data.resetRequested: true` — caller handles exit                             |
| `resume`      | Returns `data.triggerResumePicker: true` — caller shows session picker overlay        |
| `rename`      | Returns `data.name: '<name>'` — caller applies via `interactiveSession.setName(name)` |

**ISystemCommand:**

```typescript
interface ISystemCommand {
  name: string;
  description: string;
  execute(session: InteractiveSession, args: string): Promise<ICommandResult> | ICommandResult;
}
```

**ICommandResult:**

```typescript
interface ICommandResult {
  message: string;
  success: boolean;
  data?: Record<string, unknown>;
}
```

### CommandRegistry, BuiltinCommandSource, SkillCommandSource, PluginCommandSource

Command discovery and aggregation for clients that expose a slash command palette or autocomplete UI. Owned by `agent-sdk`; agent-cli re-exports `CommandRegistry` from here. `PluginCommandSource` was moved from `agent-cli` to `agent-sdk` so all clients benefit from plugin command discovery.

```typescript
import {
  CommandRegistry,
  BuiltinCommandSource,
  SkillCommandSource,
  PluginCommandSource,
} from '@robota-sdk/agent-sdk';

const registry = new CommandRegistry();
registry.addSource(new BuiltinCommandSource());
registry.addSource(new SkillCommandSource(process.cwd()));

registry.getCommands(); // ICommand[] — all commands
registry.getCommands('mod'); // filtered by prefix (for autocomplete)
registry.resolveQualifiedName('audit'); // "my-plugin:audit" or null
registry.getSubcommands('mode'); // ICommand[] — subcommands
```

`SkillCommandSource` scans (highest priority first):

1. `<cwd>/.claude/skills/*/SKILL.md`
2. `<cwd>/.claude/commands/*.md` (Claude Code compatible)
3. `~/.robota/skills/*/SKILL.md`
4. `<cwd>/.agents/skills/*/SKILL.md`

### createQuery() — Convenience Factory

`createQuery({ provider })` is a factory that returns a prompt-only function. The caller creates the provider; the factory captures it and returns a simple async function that accepts a prompt string.

```typescript
import { createQuery } from '@robota-sdk/agent-sdk';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const query = createQuery({ provider });

const response = await query('Show me the file list');

const response = await query('Analyze the code', {
  cwd: '/path/to/project',
  permissionMode: 'acceptEdits',
  maxTurns: 10,
  onTextDelta: (delta) => process.stdout.write(delta),
});
```

`createSession()` is an **internal** assembly factory — it is not exported from `@robota-sdk/agent-sdk`. Config and context loading, tool assembly, and provider wiring happen inside `InteractiveSession` and `createQuery()`.

### Session — Direct Usage (Generic)

```typescript
import { Session } from '@robota-sdk/agent-sessions';

// Session requires pre-constructed tools, provider, and systemMessage
const session = new Session({ tools, provider, systemMessage, terminal });
const response = await session.run('Hello');
```

### History Types — Re-exported from agent-core

`@robota-sdk/agent-sdk` re-exports the following history types and helpers from `@robota-sdk/agent-core`:

```typescript
import {
  IHistoryEntry,
  isChatEntry,
  chatEntryToMessage,
  messageToHistoryEntry,
  getMessagesForAPI,
} from '@robota-sdk/agent-sdk';
```

| Export                  | Kind      | Description                                                                           |
| ----------------------- | --------- | ------------------------------------------------------------------------------------- |
| `IHistoryEntry`         | interface | Rich history entry: `id`, `timestamp`, `category` ('chat' \| 'event'), `type`, `data` |
| `isChatEntry`           | function  | Type guard that narrows `IHistoryEntry` to chat entries                               |
| `chatEntryToMessage`    | function  | Converts a chat `IHistoryEntry` to `TUniversalMessage`                                |
| `messageToHistoryEntry` | function  | Converts a `TUniversalMessage` to a chat `IHistoryEntry`                              |
| `getMessagesForAPI`     | function  | Extracts `TUniversalMessage[]` from `IHistoryEntry[]` (filters to chat entries only)  |

### Built-in Tools — Direct Usage

`@robota-sdk/agent-sdk` re-exports 6 of the 8 built-in tools from `@robota-sdk/agent-tools`:

```typescript
import { bashTool, readTool, writeTool, editTool, globTool, grepTool } from '@robota-sdk/agent-sdk';
```

`webFetchTool` and `webSearchTool` are NOT re-exported from `@robota-sdk/agent-sdk`. They must be imported directly from `@robota-sdk/agent-tools`:

```typescript
import { webFetchTool, webSearchTool } from '@robota-sdk/agent-tools';
```

### Permissions — Direct Usage

```typescript
import { evaluatePermission } from '@robota-sdk/agent-core';
```

## Import Rules

These rules define which packages each layer is allowed to import from. Violations break the layered architecture.

### CLI (`agent-cli`)

| Source             | Allowed                       | Notes                                                                     |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------- |
| `agent-sdk`        | All SDK-owned public APIs     | InteractiveSession, createQuery, TInteractivePermissionHandler, etc.      |
| `agent-core`       | Public types + utilities only | TUniversalMessage, TPermissionMode, createSystemMessage, getModelName     |
| `agent-core`       | ❌ Internal engine classes    | Robota, ExecutionService, ConversationStore are forbidden                 |
| `agent-sessions`   | ❌ Forbidden                  | SDK provides its own session types; CLI must not import sessions directly |
| `agent-tools`      | ❌ Forbidden                  | SDK assembles tools internally                                            |
| `agent-provider-*` | Provider creation only        | AnthropicProvider, GoogleProvider (CLI picks which to use)                |

### SDK (`agent-sdk`)

| Source             | Allowed      | Notes                                                 |
| ------------------ | ------------ | ----------------------------------------------------- |
| `agent-core`       | Full access  |                                                       |
| `agent-sessions`   | Full access  |                                                       |
| `agent-tools`      | Full access  |                                                       |
| `agent-provider-*` | ❌ Forbidden | SDK is provider-neutral; provider comes from consumer |

### Transport packages (`agent-transport-*`)

| Source       | Allowed                                    | Notes |
| ------------ | ------------------------------------------ | ----- |
| `agent-sdk`  | InteractiveSession and related types       |       |
| `agent-core` | Public types only (TUniversalMessage etc.) |       |

## Design Decision Records

### Claude Code vs Claude Agent SDK Relationship (Research)

- Claude Agent SDK extracts the Claude Code runtime (running the CLI as a subprocess)
- Robota adopts a direct code sharing approach rather than subprocess
- Layer hierarchy: agent-cli → agent-sdk → agent-sessions → agent-core (upper layers import lower layers)
- Research document: `docs/superpowers/research/2026-03-19-claude-code-vs-agent-sdk.md`

### General/Specialized Separation Criteria

Each module's placement is determined by "Is this used only in the SDK, or is it general-purpose?":

| Module                 | Verdict                      | Rationale                                                                            |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| Permissions            | **General** → agent-core     | Tool permission checks are needed on servers too                                     |
| Hooks                  | **General** → agent-core     | Audit/validation is needed on servers too                                            |
| Built-in tools         | **General** → agent-tools    | File system tools are needed in playground/server environments too                   |
| Session                | **General** → agent-sessions | Session management is needed in any environment                                      |
| Config loading         | **SDK-specific** → agent-sdk | `.robota/settings.json` is for local environments only                               |
| Context loading        | **SDK-specific** → agent-sdk | AGENTS.md walk-up is for local environments only                                     |
| Agent tool             | **SDK-specific** → agent-sdk | Sub-session creation is an SDK assembly concern                                      |
| InteractiveSession     | **SDK-specific** → agent-sdk | Client-facing event wrapper; no CLI/React dependency; reusable by all clients        |
| SystemCommandExecutor  | **SDK-specific** → agent-sdk | Embedded in InteractiveSession; accessed via session.executeCommand(); not exported  |
| CommandRegistry et al. | **SDK-specific** → agent-sdk | Slash command discovery is useful for any client; moved from CLI to SDK              |
| ITerminalOutput        | **General** → agent-sessions | Terminal I/O abstraction (SSOT in permission-enforcer.ts; agent-cli has a duplicate) |

### Existing Package Refactoring History

- **agent-sessions**: Removed existing SessionManager/ChatInstance (zero consumers, no-op persistence), replaced with Session/SessionStore from agent-sdk
- **agent-tools**: Added 8 built-in tools in `builtins/` directory (Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch), added `TToolResult` type
- **agent-core**: Added `permissions/` and `hooks/` directories
- **agent-provider-anthropic**: Multi-block content handling (text + tool_use), streaming `chatWithStreaming`, `onTextDelta` support

## Hook Type Executors (SDK-Specific)

agent-sdk provides two additional `IHookTypeExecutor` implementations that extend the hook system beyond agent-core's built-in `command` and `http` executors:

| Executor         | Hook Type | Description                                                                                     |
| ---------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `PromptExecutor` | `prompt`  | Injects the hook's prompt text into the session context as a system-level instruction           |
| `AgentExecutor`  | `agent`   | Creates a sub-agent session (via `createSession`) to process the hook input and return a result |

These executors are registered with `runHooks` via the `executors` map during session creation in `createSession()`.

## Settings Configuration

Settings are loaded with a 6-layer precedence model (highest priority first). `.robota/` is the primary configuration convention; `.claude/` paths are supported for Claude Code compatibility.

| Layer | Path                              | Scope                                |
| ----- | --------------------------------- | ------------------------------------ |
| 1     | CLI flags / environment variables | Invocation                           |
| 2     | `.robota/settings.local.json`     | Project (local)                      |
| 3     | `.robota/settings.json`           | Project                              |
| 4     | `.claude/settings.json`           | Project (Claude Code compatible)     |
| 5     | `~/.robota/settings.json`         | User global                          |
| 6     | `~/.claude/settings.json`         | User global (Claude Code compatible) |

The `.claude/settings.json` layers (4 and 6) provide Claude Code compatibility — settings written by Claude Code are automatically picked up by Robota. Higher layers override lower layers via deep merge. `$ENV:VAR` substitution is applied after merge.

## Bundle Plugin System

Bundle plugins package reusable extensions (tools, hooks, permissions, system prompt additions) into installable units.

### Types

| Type                    | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `IBundlePluginManifest` | Plugin metadata: name, version, description, author, keywords   |
| `ILoadedBundlePlugin`   | Full bundle: manifest + tools, hooks, permissions, systemPrompt |

### Loader

`BundlePluginLoader` loads a bundle plugin from a directory path. It reads the manifest, resolves tool/hook definitions, and validates the bundle structure.

### Installer

`BundlePluginInstaller` manages plugin installation and uninstallation:

- Installs bundles to `~/.robota/plugins/` (user) or `.robota/plugins/` (project)
- Tracks installed plugins in a registry file
- Handles enable/disable state per plugin

## Marketplace Client

`MarketplaceClient` provides plugin discovery and installation from remote sources.

- **Source management**: Add, remove, and list marketplace sources
- **Default marketplace**: Built-in default source URL for the Robota plugin marketplace
- **Search**: Query available plugins by name, keyword, or category
- **Install**: Download and install plugins via `BundlePluginInstaller`

## System Prompt Skill Injection

Skills discovered from `.agents/skills/` directories are injected into the system prompt during `buildSystemPrompt()`. Each skill's content is included as a reference the model can consult when relevant tasks are requested.

## Hook Wiring into Session Lifecycle

During `createSession()`, hooks from the merged settings configuration are wired into the session lifecycle:

1. Hook configuration is extracted from the resolved config
2. SDK-specific executors (`PromptExecutor`, `AgentExecutor`) are registered alongside core executors
3. `SessionStart` hooks fire during session initialization
4. `PreToolUse`/`PostToolUse` hooks are invoked by `PermissionEnforcer` around tool execution
5. `UserPromptSubmit` hooks fire before each user message is processed
6. `Stop` hooks fire on session termination

## Subagent Execution

### createSubagentSession(options)

Assembles an isolated child Session for subagent execution. Unlike `createSession`, this factory does not load config files or context from disk — it receives pre-resolved config and context from the parent session.

**Tool filtering order:**

1. Remove disallowed tools (denylist from agent definition)
2. Keep only allowed tools (allowlist from agent definition, if specified)
3. Always remove the `Agent` tool (subagents cannot spawn subagents)

**Model resolution:** Agent definition model override (with shortcut expansion: `sonnet`, `haiku`, `opus`) takes priority; falls back to parent config model.

### Agent Definitions

`IAgentDefinition` interface defines the shape for both built-in and custom agents:

| Field             | Type       | Required | Description                                     |
| ----------------- | ---------- | -------- | ----------------------------------------------- |
| `name`            | `string`   | Yes      | Unique agent identifier                         |
| `description`     | `string`   | Yes      | Human-readable purpose description              |
| `systemPrompt`    | `string`   | Yes      | Markdown body used as the agent's system prompt |
| `model`           | `string`   | No       | Model override (inherits parent when omitted)   |
| `maxTurns`        | `number`   | No       | Maximum agentic turns                           |
| `tools`           | `string[]` | No       | Allowlist of tool names                         |
| `disallowedTools` | `string[]` | No       | Denylist of tool names                          |

**Built-in agents:**

| Name              | Model Override     | Tool Restrictions   | Purpose                     |
| ----------------- | ------------------ | ------------------- | --------------------------- |
| `general-purpose` | (parent)           | None (inherits all) | Full-capability task agent  |
| `Explore`         | `claude-haiku-4-5` | Denies Write, Edit  | Read-only code exploration  |
| `Plan`            | (parent)           | Denies Write, Edit  | Read-only planning/research |

### AgentDefinitionLoader (Internal)

`AgentDefinitionLoader` is an internal class — it is not exported from `src/index.ts`. It scans directories for custom `.md` agent definitions with YAML frontmatter, merged with built-in agents. Custom agents override built-in agents on name collision.

**Scan directories (highest priority first):**

1. `<cwd>/.robota/agents/` — project-level (primary)
2. `<cwd>/.claude/agents/` — project-level (Claude Code compatible)
3. `<home>/.robota/agents/` — user-level

### Framework System Prompt Suffixes

Two suffix modes appended to subagent system prompts:

- **Subagent suffix** (default): Instructs the agent to report concisely to the caller
- **Fork worker suffix** (`isForkWorker: true`): Instructs the agent to respond within 500 words, suitable for skill fork execution

### assembleSubagentPrompt(options)

Assembles the full system prompt for a subagent session:

1. Agent body (from agent definition `systemPrompt`)
2. CLAUDE.md content (from parent context)
3. AGENTS.md content (from parent context)
4. Framework suffix (subagent or fork worker)

### Subagent Transcript Logger

`createSubagentLogger(parentSessionId, agentId, baseLogsDir)` creates a `FileSessionLogger` that writes subagent session logs to `{baseLogsDir}/{parentSessionId}/subagents/{agentId}.jsonl`.

## Unconnected Packages (Future Integration Targets)

| Package                                    | Current State | Integration Direction                                               |
| ------------------------------------------ | ------------- | ------------------------------------------------------------------- |
| **agent-tool-mcp**                         | Unconnected   | Connect when MCP server is configured in InteractiveSession options |
| **agent-team**                             | Unconnected   | Replace agent-tool.ts with agent-team delegation pattern            |
| **agent-event-service**                    | Unconnected   | Publish Session lifecycle events                                    |
| **agent-plugin-\***                        | Unconnected   | Inject plugins during Session/Robota creation                       |
| **agent-provider-openai/google/bytedance** | Unconnected   | Consumer passes provider to InteractiveSession({ cwd, provider })   |
