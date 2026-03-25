# @robota-sdk/agent-sdk SPEC

## Overview

Robota SDK is a programming SDK built by **assembling** existing Robota packages.
It provides a single entry point corresponding to Claude Agent SDK's `query()`.

## Core Principles

1. **Assembly first**: All features are implemented using existing packages. Independent implementation is prohibited.
2. **No duplication**: If the same functionality exists in an existing package, use it. Refactor the existing package if needed.
3. **Connection required**: All features in agent-sdk must be connected to the Robota package ecosystem.
4. **General/specialized separation**: General-purpose features (permissions, hooks, tools) belong in their respective packages; only SDK-specific features (config, context) are kept in agent-sdk.

## Architecture

### Package Dependency Chain

```
Before (v3.0.0-beta.3):
agent-cli → agent-sdk → agent-sessions → agent-tools → agent-core
                                        → agent-provider-anthropic → agent-core

After (assembly refactoring):
agent-cli ─→ agent-sdk ─→ agent-sessions ─→ agent-core
  │            ├─→ agent-tools ────────────→ agent-core
  │            ├─→ agent-provider-anthropic → agent-core
  │            └─────────────────────────→ agent-core  (direct: types, permissions, hooks)
  └──────────────────────────────────────→ agent-core  (direct: types only)
```

Session is now generic (depends only on agent-core). Assembly (wiring tools, provider, system prompt) happens in agent-sdk.

### Package Roles

| Package            | Role                                                                    | General/Specialized |
| ------------------ | ----------------------------------------------------------------------- | ------------------- |
| **agent-core**     | Robota engine, execution loop, provider abstraction, permissions, hooks | General             |
| **agent-tools**    | Tool creation infrastructure + 8 built-in tools                         | General             |
| **agent-sessions** | Generic Session class, SessionStore (persistence)                       | General             |
| **agent-sdk**      | Assembly layer (config, context, query, agent-tool, session factory)    | SDK-specific        |
| **agent-cli**      | Ink TUI (terminal UI, permission-prompt)                                | CLI-specific        |

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
├── src/assembly/             ← Session factory: createSession, createDefaultTools, createProvider
├── src/config/               ← settings.json loading (3-layer merge, $ENV substitution)
├── src/context/              ← AGENTS.md/CLAUDE.md walk-up discovery, project detection, system prompt
├── src/tools/agent-tool.ts   ← Agent sub-session tool (SDK-specific: uses createSession)
├── src/permissions/          ← permission-prompt.ts (terminal approval prompt)
├── src/paths.ts              ← projectPaths / userPaths helpers
├── src/types.ts              ← re-exports shared types from agent-sessions
├── src/query.ts              ← query() SDK entry point (uses createSession)
└── src/index.ts              ← assembly exports + re-exports from agent-sessions/tools/core

agent-cli (Ink TUI — CLI-specific)
├── src/commands/             ← CommandRegistry, BuiltinCommandSource, SkillCommandSource, types
├── src/ui/                   ← App, MessageList, InputArea, StatusBar, PermissionPrompt,
│                                SlashAutocomplete, CjkTextInput, WaveText, InkTerminal, render
├── src/permissions/          ← permission-prompt.ts (terminal arrow-key selection)
├── src/types.ts              ← ITerminalOutput, ISpinner (duplicate — SSOT is agent-sessions)
├── src/cli.ts                ← CLI argument parsing, Ink render
└── src/bin.ts                ← Binary entry point
```

## Feature Details

### Session Management

- **Package**: `agent-sessions` (generic, depends only on agent-core)
- **Implementation**: Session accepts pre-constructed tools, provider, and system message. Internal concerns are delegated to PermissionEnforcer, ContextWindowTracker, and CompactionOrchestrator.
- **Assembly**: `agent-sdk/assembly/` provides `createSession()` which wires tools, provider, and system prompt from config/context.
- **Persistence**: SessionStore saves/loads/lists/deletes JSON at `~/.robota/sessions/{id}.json`

### Permission System

- **Package**: `agent-core` (general-purpose security layer)
- **Implementation**: 3-step evaluation — deny list → allow list → mode policy
- **Modes**: `plan` (read-only), `default` (write requires approval), `acceptEdits` (write auto-approved), `bypassPermissions` (all auto-approved)
- **Pattern syntax**: `Bash(pnpm *)`, `Read(/src/**)`, `Write(*)` etc. with glob matching
- **Terminal prompt**: `agent-sdk/src/permissions/permission-prompt.ts` is the SSOT implementation of the terminal approval prompt. Used by both `query()` and `agent-cli` (which imports from `@robota-sdk/agent-sdk`).
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
- **UI connection**: Session → onTextDelta → App.tsx streamingText state

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
- **Callbacks**: `onCompact` in query() options for notification when compaction occurs

## Public API

### query() — SDK Entry Point

```typescript
import { query } from '@robota-sdk/agent-sdk';

const response = await query('Show me the file list');

const response = await query('Analyze the code', {
  cwd: '/path/to/project',
  permissionMode: 'acceptEdits',
  maxTurns: 10,
  onTextDelta: (delta) => process.stdout.write(delta),
});
```

### createSession() — Assembly Factory

```typescript
import { createSession, loadConfig, loadContext, detectProject } from '@robota-sdk/agent-sdk';

const [config, context, projectInfo] = await Promise.all([
  loadConfig(cwd),
  loadContext(cwd),
  detectProject(cwd),
]);

const session = createSession({ config, context, terminal, projectInfo, permissionMode });
const response = await session.run('Hello');
```

### Session — Direct Usage (Generic)

```typescript
import { Session } from '@robota-sdk/agent-sessions';

// Session now requires pre-constructed tools, provider, and systemMessage
const session = new Session({ tools, provider, systemMessage, terminal });
const response = await session.run('Hello');
```

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

## Design Decision Records

### Claude Code vs Claude Agent SDK Relationship (Research)

- Claude Agent SDK extracts the Claude Code runtime (running the CLI as a subprocess)
- Robota adopts a direct code sharing approach rather than subprocess
- Layer hierarchy: agent-cli → agent-sdk → agent-sessions → agent-core (upper layers import lower layers)
- Research document: `docs/superpowers/research/2026-03-19-claude-code-vs-agent-sdk.md`

### General/Specialized Separation Criteria

Each module's placement is determined by "Is this used only in the SDK, or is it general-purpose?":

| Module          | Verdict                      | Rationale                                                                            |
| --------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| Permissions     | **General** → agent-core     | Tool permission checks are needed on servers too                                     |
| Hooks           | **General** → agent-core     | Audit/validation is needed on servers too                                            |
| Built-in tools  | **General** → agent-tools    | File system tools are needed in playground/server environments too                   |
| Session         | **General** → agent-sessions | Session management is needed in any environment                                      |
| Config loading  | **SDK-specific** → agent-sdk | `.robota/settings.json` is for local environments only                               |
| Context loading | **SDK-specific** → agent-sdk | AGENTS.md walk-up is for local environments only                                     |
| Agent tool      | **SDK-specific** → agent-sdk | Sub-session creation is an SDK assembly concern                                      |
| ITerminalOutput | **General** → agent-sessions | Terminal I/O abstraction (SSOT in permission-enforcer.ts; agent-cli has a duplicate) |

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

| Package                                    | Current State | Integration Direction                                    |
| ------------------------------------------ | ------------- | -------------------------------------------------------- |
| **agent-tool-mcp**                         | Unconnected   | Connect when MCP server is configured in query() options |
| **agent-team**                             | Unconnected   | Replace agent-tool.ts with agent-team delegation pattern |
| **agent-event-service**                    | Unconnected   | Publish Session lifecycle events                         |
| **agent-plugin-\***                        | Unconnected   | Inject plugins during Session/Robota creation            |
| **agent-provider-openai/google/bytedance** | Unconnected   | Select provider in query() options                       |
