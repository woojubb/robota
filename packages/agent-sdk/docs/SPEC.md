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
agent-cli → agent-sdk → agent-sessions → agent-tools → agent-core
                                        → agent-provider-anthropic → agent-core
```

### Package Roles

| Package            | Role                                                                    | General/Specialized |
| ------------------ | ----------------------------------------------------------------------- | ------------------- |
| **agent-core**     | Robota engine, execution loop, provider abstraction, permissions, hooks | General             |
| **agent-tools**    | Tool creation infrastructure + 6 built-in tools                         | General             |
| **agent-sessions** | Session class, SessionStore (persistence)                               | General             |
| **agent-sdk**      | Assembly layer (config, context, query, agent-tool)                     | SDK-specific        |
| **agent-cli**      | Ink TUI (terminal UI, permission-prompt)                                | CLI-specific        |

### Feature Layout (Current Implementation State)

```
agent-core
├── src/permissions/          ← permission-gate, permission-mode, types
├── src/hooks/                ← hook-runner, hook types
└── (existing) Robota, execution, providers, plugins

agent-tools
├── src/builtins/             ← bash, read, write, edit, glob, grep tools
├── src/types/tool-result.ts  ← TToolResult
└── (existing) FunctionTool, createZodFunctionTool, schema conversion

agent-sessions
├── src/session.ts            ← Session (Robota wrapper, permission check, tool wiring, streaming)
├── src/session-store.ts      ← SessionStore (JSON file persistence)
└── src/index.ts

agent-sdk (assembly layer — SDK-specific features only)
├── src/config/               ← settings.json loading (3-layer merge, $ENV substitution)
├── src/context/              ← AGENTS.md/CLAUDE.md walk-up discovery, project detection, system prompt
├── src/tools/agent-tool.ts   ← Agent sub-session tool (SDK-specific: Session creation)
├── src/query.ts              ← query() SDK entry point
└── src/index.ts              ← assembly + re-export

agent-cli (Ink TUI — CLI-specific)
├── src/ui/                   ← App, MessageList, InputArea, StatusBar, PermissionPrompt
├── src/permissions/          ← permission-prompt.ts (terminal arrow-key selection)
├── src/types.ts              ← ITerminalOutput, ISpinner
├── src/cli.ts                ← CLI argument parsing, Ink render
└── src/bin.ts                ← Binary entry point
```

## Feature Details

### Session Management

- **Package**: `agent-sessions`
- **Implementation**: Session class wraps Robota and integrates permission check, hook execution, tool wiring, and streaming
- **Persistence**: SessionStore saves/loads/lists/deletes JSON at `~/.robota/sessions/{id}.json`
- **History**: The original agent-sessions SessionManager/ChatInstance had zero consumers and no persistence implementation, so they were replaced with the actual implementation from agent-sdk

### Permission System

- **Package**: `agent-core` (general-purpose security layer)
- **Implementation**: 3-step evaluation — deny list → allow list → mode policy
- **Modes**: `plan` (read-only), `default` (write requires approval), `acceptEdits` (write auto-approved), `bypassPermissions` (all auto-approved)
- **Pattern syntax**: `Bash(pnpm *)`, `Read(/src/**)`, `Write(*)` etc. with glob matching
- **Terminal prompt**: Handled in `agent-cli`'s permission-prompt.ts (CLI-specific)

### Hooks System

- **Package**: `agent-core` (general-purpose extension points)
- **Events**: `PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`
- **Implementation**: Executes shell commands, passes JSON via stdin, determines allow(0)/deny(2) by exit code
- **Matcher**: Tool name regex pattern matching

### Tool System

- **Infrastructure**: `agent-tools` (createZodFunctionTool, FunctionTool, Zod→JSON conversion)
- **Built-in tools**: `agent-tools/builtins/` — Bash, Read, Write, Edit, Glob, Grep
- **Agent tool**: `agent-sdk/tools/agent-tool.ts` — sub-agent Session creation (SDK-specific)
- **Tool result type**: `TToolResult` in `agent-tools/types/tool-result.ts`

### Web Search

- **Implementation**: Anthropic server tool (`web_search_20250305`), not a `FunctionTool`
- **Behavior**: Enabled automatically when the provider is Anthropic. The system prompt includes an instruction that the agent must use `web_search` when the user asks to search the web.
- **Activation**: `enableWebTools: true` is passed in chat options for the Anthropic provider. No tool registration is required because the tool is server-managed.
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
- **Compact Instructions**: Extracts "Compact Instructions" section from CLAUDE.md and passes to Session for compaction
- **Skill Discovery Paths**: Skills are discovered from `.agents/skills/*/SKILL.md` (project) and `~/.claude/skills/*/SKILL.md` (user). Used by agent-cli's `SkillCommandSource` for slash command autocomplete

### Context Window Management

- **Token tracking**: `agent-sessions` Session tracks cumulative input tokens from provider response metadata
- **Usage state**: `session.getContextState()` returns `IContextWindowState` (usedTokens, maxTokens, usedPercentage)
- **Auto-compaction**: Triggers at ~83.5% of model context window (configurable per model)
- **Manual compaction**: `session.compact(instructions?)` generates LLM summary, replaces history
- **Model sizes**: Lookup table per model (200k for Sonnet/Haiku, 1M for Opus)
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

### Session — Direct Usage

```typescript
import { Session } from '@robota-sdk/agent-sessions';

const session = new Session({ config, context, terminal, permissionMode });
const response = await session.run('Hello');
session.getHistory();
session.clearHistory();
```

### Built-in Tools — Direct Usage

```typescript
import { bashTool, readTool, writeTool } from '@robota-sdk/agent-tools';
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

| Module          | Verdict                      | Rationale                                                          |
| --------------- | ---------------------------- | ------------------------------------------------------------------ |
| Permissions     | **General** → agent-core     | Tool permission checks are needed on servers too                   |
| Hooks           | **General** → agent-core     | Audit/validation is needed on servers too                          |
| Built-in tools  | **General** → agent-tools    | File system tools are needed in playground/server environments too |
| Session         | **General** → agent-sessions | Session management is needed in any environment                    |
| Config loading  | **SDK-specific** → agent-sdk | `.robota/settings.json` is for local environments only             |
| Context loading | **SDK-specific** → agent-sdk | AGENTS.md walk-up is for local environments only                   |
| Agent tool      | **SDK-specific** → agent-sdk | Sub-session creation is an SDK assembly concern                    |
| ITerminalOutput | **CLI-specific** → agent-cli | Terminal UI abstraction                                            |

### Existing Package Refactoring History

- **agent-sessions**: Removed existing SessionManager/ChatInstance (zero consumers, no-op persistence), replaced with Session/SessionStore from agent-sdk
- **agent-tools**: Added 6 built-in tools in `builtins/` directory, added `TToolResult` type
- **agent-core**: Added `permissions/` and `hooks/` directories
- **agent-provider-anthropic**: Multi-block content handling (text + tool_use), streaming `chatWithStreaming`, `onTextDelta` support

## Unconnected Packages (Future Integration Targets)

| Package                                    | Current State | Integration Direction                                    |
| ------------------------------------------ | ------------- | -------------------------------------------------------- |
| **agent-tool-mcp**                         | Unconnected   | Connect when MCP server is configured in query() options |
| **agent-team**                             | Unconnected   | Replace agent-tool.ts with agent-team delegation pattern |
| **agent-event-service**                    | Unconnected   | Publish Session lifecycle events                         |
| **agent-plugin-\***                        | Unconnected   | Inject plugins during Session/Robota creation            |
| **agent-provider-openai/google/bytedance** | Unconnected   | Select provider in query() options                       |
