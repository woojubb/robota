# Using the SDK

`@robota-sdk/agent-sdk` is the provider-neutral assembly layer that composes `agent-core`, `agent-tools`, `agent-sessions`, runtime services, commands, context loading, and transports into a cohesive experience. It exposes `InteractiveSession` as the primary entry point and `createQuery()` as the one-shot convenience API. Consumers create the provider instance and pass it in.

## InteractiveSession — Primary Entry Point

`InteractiveSession` is the primary entry point for any interactive use case — CLI, web front-end, API server, or dynamic worker. It wraps `Session` via composition and provides an event-driven, queue-aware API.

```typescript
import { InteractiveSession } from '@robota-sdk/agent-sdk';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  permissionMode: 'default',
});

session.on('text_delta', (delta) => process.stdout.write(delta));

// Submit a prompt (queued automatically if a run is in progress)
await session.submit('Refactor the auth module');

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

`IHistoryEntry` has a `category` field: `'chat'` entries carry role/content for the AI provider; `'event'` entries carry typed metadata for display. When forwarding conversation context to an AI provider, the session filters to chat-only entries automatically — the provider never sees event entries.

Event types include: `tool-start` (individual tool execution began), `tool-end` (individual tool execution completed with result), `tool-summary` (aggregated summary at execution end), and `skill-invocation` (skill activated).

### Command Discovery

The SDK owns `CommandRegistry` and common command sources used by clients:

- **`BuiltinCommandSource`** — SDK-core compatibility source; currently empty because user-visible built-ins are command modules
- **Command modules** — product-composed built-ins such as `skills`, `help`, `clear`, `compact`, `mode`, `model`, `cost`, `context`, `permissions`, `memory`, `rewind`, `provider`, `resume`, `background`, `rename`, `plugin`, `reload-plugins`, `language`, `reset`, and `exit`; UI shells render and parse them as slash syntax
- **`SkillCommandSource`** — project and user skills discovered from `.agents/skills/`, `.claude/skills/`, `.claude/commands/`, and `~/.robota/skills/`
- **`PluginCommandSource`** — commands contributed by loaded plugins

Clients such as the CLI compose command modules into a registry for autocomplete. `InteractiveSession.listCommands()` returns executable system commands for transports and direct command execution. Explicit `/skill-name` prompts are virtual aliases normalized by SDK to command `skills` with args `<skill-name> [args]` when the skills command module is composed.

Skill metadata is exposed to the model only when `skills` is composed as a model-invocable command. Without that descriptor, the SDK does not add a `## Skills` section because there would be no standard activation route.

### System Commands

`SystemCommandExecutor` is embedded inside `InteractiveSession`. Consumers access commands through `session.executeCommand(name, args)` and `session.listCommands()` — the executor is not independently exported.

Transport and UI layers parse explicit slash input and call `session.executeCommand()` before submitting normal prompts. Command routing stays generic: virtual `/skill-name` aliases normalize to command `skills` with args `<skill-name> [args]` only when the skills command module is composed.

Transport adapters (HTTP, WS, MCP) use `session.listCommands()` to discover available commands and `session.executeCommand()` to execute them.

## createQuery() — Convenience API

`createQuery({ provider })` is a lightweight factory that builds a one-shot query function pre-configured for a specific provider. Use it when you want simple prompt-in/response-out calls but need to reuse a configured provider instance across multiple calls.

```typescript
import { createQuery } from '@robota-sdk/agent-sdk';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
const ask = createQuery({ provider });
const response = await ask('List all TypeScript files in this project');
```

## One-Shot Usage

The simplest way to interact with Robota is to create a query function and call it with a prompt. `createQuery()` builds an `InteractiveSession` internally, loads settings and project context from the working directory, and cleans up after each prompt.

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

Config is loaded from 6 settings-file layers. `.robota/` is the primary configuration convention; `.claude/` paths are supported as a Claude Code compatibility layer. Later layers override earlier ones:

1. **User global**: `~/.robota/settings.json` (lowest priority)
2. **User global (Claude Code compatible)**: `~/.claude/settings.json`
3. **Project (primary)**: `.robota/settings.json`
4. **Project local**: `.robota/settings.local.json` (gitignored)
5. **Project (Claude Code compatible)**: `.claude/settings.json`
6. **Project local (Claude Code compatible)**: `.claude/settings.local.json` (gitignored, highest priority)

The `.claude/` paths take higher runtime priority so that Claude Code settings override `.robota/` defaults.

```json
{
  "currentProvider": "qwen",
  "providers": {
    "qwen": {
      "type": "qwen",
      "model": "qwen-plus",
      "apiKey": "$ENV:DASHSCOPE_API_KEY",
      "baseURL": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    },
    "openai": {
      "type": "openai",
      "model": "gpt-4o",
      "apiKey": "$ENV:OPENAI_API_KEY"
    },
    "local-gemma": {
      "type": "gemma",
      "model": "supergemma4-26b-uncensored-v2",
      "apiKey": "lm-studio",
      "baseURL": "http://localhost:1234/v1"
    },
    "anthropic": {
      "type": "anthropic",
      "model": "claude-sonnet-4-6",
      "apiKey": "$ENV:ANTHROPIC_API_KEY"
    }
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

`InteractiveSession` loads these settings for permissions, hooks, project context, skills, and session behavior. Provider profile resolution is performed by the consumer shell before creating the SDK session; the CLI uses `currentProvider` and `providers` to construct the active provider instance, then passes that instance to `InteractiveSession`. OpenAI uses `type: "openai"` with the official OpenAI API and defaults to the Responses API. Qwen Model Studio uses `type: "qwen"` plus the documented DashScope OpenAI-compatible `baseURL`. Local Gemma-family endpoints should use `type: "gemma"`. A generic OpenAI-compatible Chat Completions endpoint can still be configured with `type: "openai"`, `baseURL`, and optional `options.apiSurface: "chat-completions"` when no model-family provider fits. The legacy single `provider` object remains supported by CLI/provider-settings compatibility code when no active profile is configured.

The `$ENV:` prefix resolves environment variables at load time.

## Context Discovery

`InteractiveSession` walks up from the working directory to find project context during initialization:

- **AGENTS.md** — Project-level agent instructions and rules
- **CLAUDE.md** — Additional agent instructions (Claude Code compatible)
- **Compact Instructions** — Extracted from CLAUDE.md for use during context compaction

```typescript
const session = new InteractiveSession({
  cwd: '/path/to/project',
  provider,
});
```

Use `bare: true` when you need a session without AGENTS.md/CLAUDE.md loading or plugin discovery.

## System Prompt

The SDK assembles the system prompt internally from loaded project context, tool descriptions, command descriptors, trust level, active task context, and optional appended instructions.

```typescript
const session = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  appendSystemPrompt: 'Prefer concise responses.',
});
```

## Session Features

`InteractiveSession` provides these capabilities:

| Feature                    | Description                                                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Permission enforcement** | Tool calls are gated by the permission system                                                                                                                                                |
| **Hook execution**         | PreToolUse/PostToolUse/PreCompact/PostCompact hooks fire automatically                                                                                                                       |
| **Context tracking**       | Token usage is tracked and available via `getContextState()`                                                                                                                                 |
| **Auto-compaction**        | Context is compressed when usage exceeds ~83.5%                                                                                                                                              |
| **Session persistence**    | Conversations can be saved/loaded through SDK-owned session store facades. Records include `history` (`IHistoryEntry[]`), background task snapshots, and sandbox snapshot ids when available |
| **Session resume/fork**    | Restore a previous session with `resumeSessionId` or fork with `forkSession`. On non-fork resume, sandbox hydration runs before `session.injectMessage()` restores AI context                |
| **Session naming**         | `getName()` / `setName()` for human-friendly session identification                                                                                                                          |
| **Abort**                  | `session.abort()` cancels via AbortSignal. Partial response committed as `'interrupted'`                                                                                                     |
| **Universal history**      | `getFullHistory()` returns `IHistoryEntry[]` — the unified chat + event timeline                                                                                                             |
| **Background work**        | Subagent jobs are tracked through runtime-owned task state, transcripts, and background task events                                                                                          |
| **Replay events**          | Session runs forward core provider/tool boundary events into append-only JSONL logs                                                                                                          |
| **Sandbox execution**      | Optional sandbox clients route Bash and core file tools through an injected execution plane; workspace manifests can prepare fresh sandbox files/directories before session creation         |

## Sandbox Execution

`InteractiveSession` accepts `sandboxClient?: ISandboxClient`. When present, the SDK creates sandbox-aware Bash, Read, Write, and Edit tools. This keeps the CLI/TUI thin: hosts choose whether to supply a sandbox, while tool command/file behavior remains in `agent-tools`.

```typescript
import { InteractiveSession } from '@robota-sdk/agent-sdk';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { E2BSandboxClient } from '@robota-sdk/agent-tools';
import type { IWorkspaceManifest } from '@robota-sdk/agent-tools';
import { Sandbox } from 'e2b';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const sandbox = await Sandbox.create();
const workspaceManifest: IWorkspaceManifest = {
  entries: {
    'task.md': { type: 'file', content: 'Analyze this project.\n' },
    repo: { type: 'gitRepo', url: 'https://github.com/example/project.git', ref: 'main' },
    output: { type: 'dir' },
  },
};

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  sandboxClient: new E2BSandboxClient({ sandbox }),
  workspaceManifest,
  reversibleExecution: { mode: 'local-first' },
});
```

`E2BSandboxClient` adapts E2B-compatible objects from its owning package, `agent-tools`, but does not require `agent-sdk` or `agent-tools` to depend on the `e2b` package. Applications install provider SDKs at their composition root and pass the adapted client into the SDK. `workspaceManifest` is also owned by `agent-tools`; SDK only applies it during async interactive session initialization. Inline/local files, directories, and Git repositories are supported by the generic applicator. Cloud mount entries return `unsupported` until the chosen sandbox adapter implements native mounting.

If the injected sandbox client implements `snapshot()` and `restore(snapshotId)`, `InteractiveSession.shutdown()` saves `sandboxSnapshotId` into the session record. A later non-fork `resumeSessionId` restore hydrates that sandbox reference before saved messages are replayed. Forked sessions start from a fresh execution environment unless the host explicitly supplies its own sandbox reference.

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

### Agent Command Batch Jobs

The `agent` command module, rendered as `/agent` by CLI/headless shells, supports batch `jobs` input for explicit parallel requests through the standard command route:

```typescript
{
  jobs: [
    { prompt: 'Review the API contract', subagent_type: 'Plan' },
    { prompt: 'Inspect implementation risks', subagent_type: 'Explore' },
  ],
}
```

When `jobs` is present, `/agent` starts every valid job before waiting for results. The returned JSON includes `success`, `groupId`, `agentIds`, and ordered per-job results. Model routing uses `ExecuteCommand(command: "agent", args: ...)` rather than a parallel `Agent` tool route.

### Tool Filtering

Subagent tool access is resolved in order: denylist (`disallowedTools`) is applied first, then allowlist (`tools`) filters to permitted tools only. Agent command tooling is not exposed recursively inside subagent sessions.

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

Subagent execution is logged to `{logsDir}/{parentSessionId}/subagents/{agentId}.jsonl` for debugging and audit purposes. Streaming text deltas are appended to this transcript while the provider request is still running. The parent session JSON stores the background task snapshot and transcript path; it does not rewrite the whole session file for every token chunk.

## Replay-Grade Session Events

`Session.run()` now forwards core execution events through the session logger. Current events include provider request envelopes, provider-native raw request/response/stream payloads, provider-normalized responses, assistant message commits, tool batch starts, tool execution requests, and tool execution results.

These events are append-only provenance for debugging and future `/resume` replay. Concrete provider packages own exact SDK-native payload selection through `IChatOptions.onProviderNativeRawPayload`; `agent-core` routes the callback without provider branches, and `agent-sessions` validates that provider requests have native raw response or stream payload coverage.

## Always-Streaming Policy

The Anthropic provider always uses the streaming API internally, even when no `onTextDelta` callback is provided. This avoids the 10-minute HTTP timeout that can occur with long-running tool loops on non-streaming requests. The final response text is assembled from the stream. See [agent-provider-anthropic SPEC.md](../../packages/agent-provider-anthropic/docs/SPEC.md) for details.

## Output Token Limits

The Anthropic provider uses `getModelMaxOutput()` to determine the default `max_tokens` value per model rather than hardcoding a fixed limit. Current defaults: Sonnet 4.6 supports 64K output tokens, Opus 4.6 supports 128K output tokens. See [agent-provider-anthropic SPEC.md](../../packages/agent-provider-anthropic/docs/SPEC.md) for details.

## Marketplace Client

`MarketplaceClient` manages plugin marketplace registries via git clones stored in `~/.robota/marketplaces/`. It supports GitHub repositories, arbitrary git URLs, and local filesystem paths as marketplace sources. The CLI exposes this through the `@robota-sdk/agent-command-plugin` module and its `/plugin marketplace add/remove/list/update` commands. See [agent-sdk SPEC.md](../../packages/agent-sdk/docs/SPEC.md) for the full API.

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

| Use case                       | Approach                                                                 |
| ------------------------------ | ------------------------------------------------------------------------ |
| Quick one-shot                 | `createQuery({ provider })` — creates an `InteractiveSession` internally |
| Interactive CLI / web / server | `InteractiveSession` — event-driven, queuing, command handling           |
| Expose over HTTP / MCP / WS    | `agent-transport-{http,mcp,ws}` wrapping `InteractiveSession`            |
| Non-interactive / headless     | `agent-transport-headless` — text, JSON, or stream-JSON output           |
| Call a remote agent over HTTP  | `agent-remote-client` — standalone HTTP client                           |
| Custom agent (no SDK)          | `new Robota()` from `agent-core` directly                                |
| Custom session (no SDK)        | `new Session()` from `agent-sessions` with your own tools/provider       |
