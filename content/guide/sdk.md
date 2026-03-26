# Using the SDK

`@robota-sdk/agent-sdk` is the assembly layer that composes `agent-core`, `agent-tools`, `agent-sessions`, and `agent-provider-anthropic` into a cohesive experience. It provides configuration loading, project context discovery, and the `InteractiveSession` primary entry point along with the `query()` convenience API.

## InteractiveSession — Primary Entry Point

`InteractiveSession` is the primary entry point for any interactive use case — CLI, web front-end, API server, or dynamic worker. It wraps `Session` via composition and provides an event-driven, queue-aware API.

```typescript
import { InteractiveSession } from '@robota-sdk/agent-sdk';

const session = new InteractiveSession({
  cwd: process.cwd(),
  permissionMode: 'default',
  onTextDelta: (delta) => process.stdout.write(delta),
});

// Submit a prompt (queued automatically if a run is in progress)
session.submit('Refactor the auth module');

// Abort the in-flight run (partial response saved as 'interrupted')
session.abort();

// Cancel the queued prompt without touching the in-flight run
session.cancelQueue();
```

### Events

`InteractiveSession` emits typed events. Clients subscribe and translate them into framework-specific state:

| Event            | Payload            | When                                       |
| ---------------- | ------------------ | ------------------------------------------ |
| `text_delta`     | `string`           | Streaming text chunk from the model        |
| `tool_start`     | `ToolStartPayload` | Tool invocation started                    |
| `tool_end`       | `ToolEndPayload`   | Tool invocation completed                  |
| `thinking`       | `SessionStatus`    | Run started, completed, aborted, or queued |
| `context_update` | `ContextState`     | Token usage updated                        |
| `error`          | `Error`            | Run failed                                 |

### History: IHistoryEntry[]

`InteractiveSession` maintains a universal history as `IHistoryEntry[]`. Each entry represents either a chat message (user or assistant turn) or a session event (tool call, system event, etc.). This unified timeline is the source of truth for display and persistence.

```typescript
import type { IHistoryEntry } from '@robota-sdk/agent-core';

// Retrieve the full history
const history: IHistoryEntry[] = session.getFullHistory();
```

`IHistoryEntry` has a `kind` discriminant: `'chat'` entries carry role/content for the AI provider; event entries carry typed metadata for display. When forwarding conversation context to an AI provider, the session filters to chat-only entries automatically — the provider never sees event entries.

### Command Discovery

`InteractiveSession` integrates a `CommandRegistry` that aggregates two sources:

- **`BuiltinCommandSource`** — built-in slash commands: `/help`, `/clear`, `/compact`, `/mode`, `/model`, `/cost`, `/context`, `/permissions`, `/exit`, `/plugin`, `/reload-plugins`, `/language`, `/resume`, `/rename`
- **`SkillCommandSource`** — project and user skills discovered from `.agents/skills/`, `.claude/skills/`, `.claude/commands/`, and `~/.robota/skills/`

Calling `session.getCommands()` returns the merged list for autocomplete.

### System Commands

`SystemCommandExecutor` is embedded inside `InteractiveSession`. Consumers access commands through `session.executeCommand(name, args)` and `session.listCommands()` — the executor is not independently exported.

Before each submitted prompt, the session checks whether the input matches a built-in system command. If it does, the command is executed directly (e.g., clearing history, switching model, running compaction) and no LLM call is made. Unrecognized inputs are forwarded to the session's `run()`.

Transport adapters (HTTP, WS, MCP) use `session.listCommands()` to discover available commands and `session.executeCommand()` to execute them.

## createQuery() — Convenience API

`createQuery({ provider })` is a lightweight factory that builds a one-shot query function pre-configured for a specific provider. Use it when you want `query()`-style simplicity but need to reuse a configured instance across multiple calls.

```typescript
import { createQuery } from '@robota-sdk/agent-sdk';

const ask = createQuery({ provider: 'anthropic' });
const response = await ask('List all TypeScript files in this project');
```

## query() — One-Shot API

The simplest way to interact with Robota. Handles config, context, session creation, and cleanup automatically.

```typescript
import { createQuery } from '@robota-sdk/agent-sdk';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
const query = createQuery({ provider });

const response = await query('List all TypeScript files in this project');
```

### Options

```typescript
const query = createQuery({
  provider,
  cwd: '/path/to/project',
  permissionMode: 'acceptEdits',
  maxTurns: 10,
});

const response = await query('Refactor this function');
```

## Configuration

Config is loaded from 5 layers. `.robota/` is the primary configuration convention; `.claude/` paths are supported as a Claude Code compatibility layer. Later layers override earlier ones:

1. **User global**: `~/.robota/settings.json` (lowest priority)
2. **Project (primary)**: `.robota/settings.json`
3. **Project local**: `.robota/settings.local.json` (gitignored)
4. **Project (Claude Code compatible)**: `.claude/settings.json`
5. **Project local (Claude Code compatible)**: `.claude/settings.local.json` (gitignored, highest priority)

The `.claude/` paths take higher runtime priority so that Claude Code settings override `.robota/` defaults.

```json
{
  "provider": {
    "name": "anthropic",
    "model": "claude-sonnet-4-6",
    "apiKey": "$ENV:ANTHROPIC_API_KEY"
  },
  "defaultTrustLevel": "moderate",
  "permissions": {
    "allow": ["Read(*)", "Glob(*)", "Grep(*)"],
    "deny": ["Bash(rm -rf *)"]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "bash .hooks/log-tool.sh" }]
      }
    ]
  }
}
```

The `$ENV:` prefix resolves environment variables at load time.

## Context Discovery

`loadContext()` walks up from the working directory to find project context:

- **AGENTS.md** — Project-level agent instructions and rules
- **CLAUDE.md** — Additional agent instructions (Claude Code compatible)
- **Compact Instructions** — Extracted from CLAUDE.md for use during context compaction

```typescript
const context = await loadContext('/path/to/project');
// { agentsMd: string, claudeMd: string, compactInstructions?: string }
```

## System Prompt

`buildSystemPrompt()` assembles the system prompt from context, tools, and trust level:

```typescript
import { buildSystemPrompt } from '@robota-sdk/agent-sdk';

const systemMessage = buildSystemPrompt({
  agentsMd: context.agentsMd,
  claudeMd: context.claudeMd,
  toolDescriptions: ['Bash — execute shell commands', 'Read — read file contents'],
  trustLevel: 'moderate',
  projectInfo: { type: 'node', language: 'typescript' },
});
```

## Session Features

`InteractiveSession` provides these capabilities:

| Feature                    | Description                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Permission enforcement** | Tool calls are gated by the permission system                                                                                                                 |
| **Hook execution**         | PreToolUse/PostToolUse/PreCompact/PostCompact hooks fire automatically                                                                                        |
| **Context tracking**       | Token usage is tracked and available via `getContextState()`                                                                                                  |
| **Auto-compaction**        | Context is compressed when usage exceeds ~83.5%                                                                                                               |
| **Session persistence**    | Conversations can be saved/loaded via `SessionStore`. `ISessionRecord` includes `history` (`IHistoryEntry[]`) for full UI restoration                         |
| **Session resume/fork**    | Restore a previous session with `resumeSessionId` or fork with `forkSession`. On resume, `session.injectMessage()` restores AI context from persisted history |
| **Session naming**         | `getName()` / `setName()` for human-friendly session identification                                                                                           |
| **Abort**                  | `session.abort()` cancels via AbortSignal. Partial response committed as `'interrupted'`                                                                      |
| **Universal history**      | `getFullHistory()` returns `IHistoryEntry[]` — the unified chat + event timeline                                                                              |

## Subagent Sessions

`createSubagentSession()` spawns a child session for delegating subtasks to a subagent. The child session forks the parent's context (`context:fork`), inherits hooks and permissions, and runs independently.

```typescript
import { createSubagentSession } from '@robota-sdk/agent-sdk';

const subSession = createSubagentSession({
  parentSession: session,
  agentDefinition: 'explore', // built-in agent type
  prompt: 'Find all usages of the deprecated API',
});

const result = await subSession.run();
```

### Tool Filtering

Subagent tool access is resolved in order: denylist (`disallowedTools`) is applied first, then allowlist (`tools`) filters to permitted tools only. The `Agent` tool is always removed from subagent sessions to prevent recursive spawning.

### Model Shortcuts

Agent definitions accept model shortcuts that resolve to full model IDs: `sonnet` -> `claude-sonnet-4-6`, `haiku` -> `claude-haiku-4-5`, `opus` -> `claude-opus-4-6`.

### Agent Definitions

Agent definitions describe reusable agent configurations. Built-in types:

| Type            | Model   | Tools     | Description                              |
| --------------- | ------- | --------- | ---------------------------------------- |
| General-purpose | inherit | all tools | Full tool access, inherits parent model  |
| `explore`       | haiku   | read-only | Lightweight codebase exploration         |
| `plan`          | inherit | read-only | Multi-step planning with read-only tools |

Custom agent definitions can be placed in `.robota/agents/` (primary) or `.claude/agents/` (Claude Code compatible) and are loaded by `AgentDefinitionLoader`. See [agent-sdk SPEC.md](../../packages/agent-sdk/docs/SPEC.md) for the `IAgentDefinition` interface.

### Agent Definition Schema

| Field             | Type     | Description                                   |
| ----------------- | -------- | --------------------------------------------- |
| `name`            | string   | Agent identifier                              |
| `description`     | string   | What the agent does                           |
| `systemPrompt`    | string   | Agent's system prompt (markdown body)         |
| `model`           | string   | Model override (sonnet/haiku/opus or full ID) |
| `maxTurns`        | number   | Max agentic turns                             |
| `tools`           | string[] | Tool allowlist                                |
| `disallowedTools` | string[] | Tool denylist                                 |

### Framework Suffixes

The SDK appends a framework suffix to the subagent's system prompt to shape its output format. Subagents receive a suffix requesting a concise report of findings. Fork workers receive a structured suffix with a 500-word limit.

### Subagent Transcript

Subagent execution is logged to `{logsDir}/{parentSessionId}/subagents/{agentId}.jsonl` for debugging and audit purposes.

## Always-Streaming Policy

The Anthropic provider always uses the streaming API internally, even when no `onTextDelta` callback is provided. This avoids the 10-minute HTTP timeout that can occur with long-running tool loops on non-streaming requests. The final response text is assembled from the stream. See [agent-provider-anthropic SPEC.md](../../packages/agent-provider-anthropic/docs/SPEC.md) for details.

## Output Token Limits

The Anthropic provider uses `getModelMaxOutput()` to determine the default `max_tokens` value per model rather than hardcoding a fixed limit. Current defaults: Sonnet 4.6 supports 64K output tokens, Opus 4.6 supports 128K output tokens. See [agent-provider-anthropic SPEC.md](../../packages/agent-provider-anthropic/docs/SPEC.md) for details.

## Marketplace Client

`MarketplaceClient` manages plugin marketplace registries via git clones stored in `~/.robota/marketplaces/`. It supports GitHub repositories, arbitrary git URLs, and local filesystem paths as marketplace sources. The CLI exposes this through `/plugin marketplace add/remove/list/update` commands. See [agent-sdk SPEC.md](../../packages/agent-sdk/docs/SPEC.md) for the full API.

## Transport Adapters

`InteractiveSession` is the single entry point for all interactive use cases. Transport adapters in the `agent-transport-*` packages consume it to expose the session over different protocols:

| Package                    | Protocol                       | Description                                                      |
| -------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| `agent-transport-http`     | HTTP / REST                    | Hono-based adapter; runs on Cloudflare Workers, Node.js, Lambda  |
| `agent-transport-mcp`      | MCP                            | Exposes the session as an MCP server for Claude and other agents |
| `agent-transport-ws`       | WebSocket                      | Framework-agnostic real-time adapter (any WS library)            |
| `agent-transport-headless` | stdin/stdout (non-interactive) | Non-interactive execution with text/json/stream-json output      |

Each transport wraps an `InteractiveSession` instance and translates protocol messages into `submit()` / `abort()` calls, then forwards emitted events back to the client. No separate gateway interface exists — `InteractiveSession` is the gateway.

All transport adapters implement the `ITransportAdapter` interface (exported from `@robota-sdk/agent-sdk`), which defines a common lifecycle: `attach(session)`, `start()`, and `stop()`. Each package provides a factory function (e.g., `createHttpTransport()`, `createWsTransport()`, `createMcpTransport()`, `createHeadlessTransport()`) that returns an `ITransportAdapter`. `createHeadlessTransport()` also accepts a `createHeadlessRunner()` helper for pre-configured non-interactive execution.

`agent-remote-client` is a companion package that provides an HTTP client for calling an agent exposed via `agent-transport-http`. It has no dependency on `agent-sdk`.

## Assembly vs Direct Usage

| Use case                       | Approach                                                           |
| ------------------------------ | ------------------------------------------------------------------ |
| Quick one-shot                 | `query()` / `createQuery({ provider })` — handles everything       |
| Interactive CLI / web / server | `InteractiveSession` — event-driven, queuing, command handling     |
| Expose over HTTP / MCP / WS    | `agent-transport-{http,mcp,ws}` wrapping `InteractiveSession`      |
| Non-interactive / headless     | `agent-transport-headless` — text, JSON, or stream-JSON output     |
| Call a remote agent over HTTP  | `agent-remote-client` — standalone HTTP client                     |
| Custom agent (no SDK)          | `new Robota()` from `agent-core` directly                          |
| Custom session (no SDK)        | `new Session()` from `agent-sessions` with your own tools/provider |
