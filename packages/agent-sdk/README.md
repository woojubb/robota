# @robota-sdk/agent-sdk

Programmatic SDK for building AI agents with Robota. Provides `InteractiveSession` as the central client-facing API, `query()` for one-shot use, session management, built-in tools, permissions, hooks, streaming, and context loading.

This is the **assembly layer** of the Robota ecosystem — it composes lower-level packages (`agent-core`, `agent-tools`, `agent-sessions`, `agent-provider-anthropic`) into a cohesive SDK.

**Version**: 3.0.0-beta.33

## Installation

```bash
npm install @robota-sdk/agent-sdk
# or
pnpm add @robota-sdk/agent-sdk
```

## Quick Start

```typescript
import { query } from '@robota-sdk/agent-sdk';

// Simple one-shot query
const response = await query('Show me the file list');

// With options
const response = await query('Analyze the code', {
  cwd: '/path/to/project',
  permissionMode: 'acceptEdits',
  maxTurns: 10,
  onTextDelta: (delta) => process.stdout.write(delta),
});
```

## Features

- **InteractiveSession** — Event-driven session wrapper (composition over Session). Central client-facing API for CLI, web, API server, or any other client
- **SystemCommandExecutor + ISystemCommand** — SDK-level command execution. Built-in commands: `help`, `clear`, `compact`, `mode`, `model`, `language`, `cost`, `context`, `permissions`, `reset`
- **CommandRegistry, BuiltinCommandSource, SkillCommandSource** — Slash command registry and discovery (owned by SDK; agent-cli re-exports `CommandRegistry` from here)
- **query()** — Single entry point for one-shot AI agent interactions with streaming support
- **createSession()** — Assembly factory: wires tools, provider, config, and context into a Session
- **Built-in Tools** — Bash, Read, Write, Edit, Glob, Grep (re-exported from `@robota-sdk/agent-tools`)
- **Agent Tool** — Sub-agent session creation for multi-agent workflows
- **Permissions** — 3-step evaluation (deny list, allow list, mode policy) with four modes: `plan`, `default`, `acceptEdits`, `bypassPermissions`
- **Hooks** — `PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `UserPromptSubmit`, `Stop` events with shell command execution
- **Streaming** — Real-time text delta callbacks via `onTextDelta`
- **Context Loading** — AGENTS.md / CLAUDE.md walk-up discovery and system prompt assembly
- **Config Loading** — 6-layer merge (CLI flags, local, project, Claude Code compat, user global, user global Claude Code compat) with `$ENV:VAR` substitution
- **Context Window Management** — Token tracking, auto-compaction at ~83.5%, manual `session.compact()`
- **Bundle Plugin System** — Install and manage reusable extensions packaged as bundle plugins

## Architecture

```
agent-sdk (assembly layer)
  ├── InteractiveSession  ← central client-facing API (event-driven)
  │     └── Session       ← generic session (agent-sessions)
  ├── SystemCommandExecutor ← SDK-level command execution
  ├── CommandRegistry / BuiltinCommandSource / SkillCommandSource
  ├── query()             ← one-shot entry point
  ├── createSession()     ← assembly factory
  └── deps:
        agent-sessions  (Session, SessionStore)
        agent-tools     (tool infrastructure + 8 built-in tools)
        agent-provider-anthropic (Anthropic LLM provider)
        agent-core      (Robota engine, providers, permissions, hooks)

agent-cli (TUI layer — bridges InteractiveSession events to React/Ink state)
  → agent-sdk
```

The SDK is **pure TypeScript with no React dependency**. The CLI is a thin TUI-only layer that consumes `InteractiveSession` events and maps them to React state. Any other client (web app, API server, worker) can do the same.

## API

### InteractiveSession — Central Client-Facing API

`InteractiveSession` wraps `Session` (composition over inheritance) to provide event-driven interaction for any client. It manages streaming text accumulation, tool execution state tracking, prompt queuing, abort orchestration, and message history. Logic that was previously embedded in CLI React hooks now lives here.

```typescript
import { InteractiveSession } from '@robota-sdk/agent-sdk';
import type { IInteractiveSessionOptions } from '@robota-sdk/agent-sdk';

const session = new InteractiveSession({
  config,
  context,
  projectInfo,
  sessionStore,
  permissionMode: 'default',
  maxTurns: 10,
  cwd: process.cwd(),
  permissionHandler: async (toolName, toolArgs) => ({ allowed: true }),
});

// Subscribe to events
session.on('text_delta', (delta: string) => {
  process.stdout.write(delta); // streaming text chunk
});
session.on('tool_start', (state) => {
  console.log(`Running: ${state.toolName}`);
});
session.on('tool_end', (state) => {
  console.log(`Done: ${state.toolName} — ${state.result}`);
});
session.on('thinking', (isThinking: boolean) => {
  // show/hide spinner
});
session.on('complete', (result) => {
  console.log(result.response);
});
session.on('error', (error: Error) => {
  console.error(error);
});
session.on('context_update', (state) => {
  // token usage updated
});
session.on('interrupted', (result) => {
  // abort completed
});

// Submit a prompt (queues if already executing, max 1 queued)
await session.submit('Explain this code');

// Submit with display override (shown in UI) and raw input (for hook matching)
await session.submit(fullPrompt, '/audit', '/rulebased-harness:audit');

// Abort current execution and clear queue
session.abort();

// Cancel queued prompt without aborting current execution
session.cancelQueue();

// State queries
session.isExecuting(); // boolean
session.getPendingPrompt(); // string | null
session.getMessages(); // TUniversalMessage[]
session.getContextState(); // IContextWindowState
session.getStreamingText(); // string (accumulated so far)
session.getActiveTools(); // IToolState[]

// Access underlying Session for advanced use
session.getSession(); // Session
```

### SystemCommandExecutor — SDK-Level Commands

`SystemCommandExecutor` executes named system commands against an `InteractiveSession`. Commands are pure TypeScript — no React, no TUI dependency. The CLI wraps them as slash commands with UI chrome.

```typescript
import { SystemCommandExecutor, createSystemCommands } from '@robota-sdk/agent-sdk';
import type { ICommandResult } from '@robota-sdk/agent-sdk';

const executor = new SystemCommandExecutor(); // loads built-in commands by default

// Execute a command
const result: ICommandResult | null = await executor.execute('context', session, '');
if (result) {
  console.log(result.message); // "Context: 12,345 / 200,000 tokens (6%)"
  console.log(result.data); // { usedTokens, maxTokens, percentage }
}

// Register a custom command
executor.register({
  name: 'status',
  description: 'Show agent status',
  execute: (session, args) => ({ message: 'OK', success: true }),
});

// List all commands
executor.listCommands(); // ISystemCommand[]
executor.hasCommand('mode'); // boolean
```

Built-in commands:

| Command       | Description                                             |
| ------------- | ------------------------------------------------------- |
| `help`        | Show available commands                                 |
| `clear`       | Clear conversation history                              |
| `compact`     | Compress context window (optional focus instructions)   |
| `mode [m]`    | Show or change permission mode                          |
| `model <id>`  | Change AI model                                         |
| `language`    | Set response language (ko, en, ja, zh)                  |
| `cost`        | Show session info (session ID, message count)           |
| `context`     | Context window token usage                              |
| `permissions` | Show current permission mode and session-approved tools |
| `reset`       | Delete settings (caller handles file I/O and exit)      |

### CommandRegistry, BuiltinCommandSource, SkillCommandSource

These classes provide slash command discovery and aggregation for clients that expose a command palette or autocomplete UI.

```typescript
import { CommandRegistry, BuiltinCommandSource, SkillCommandSource } from '@robota-sdk/agent-sdk';

const registry = new CommandRegistry();
registry.addSource(new BuiltinCommandSource());
registry.addSource(new SkillCommandSource(process.cwd()));

// Get all commands (returns ISlashCommand[])
const commands = registry.getCommands();

// Filter by prefix (for autocomplete)
const filtered = registry.getCommands('mod'); // matches "mode", "model"

// Resolve short plugin name to fully qualified form
registry.resolveQualifiedName('audit'); // "my-plugin:audit"
```

`SkillCommandSource` discovers skills from (highest priority first):

- `<cwd>/.claude/skills/*/SKILL.md`
- `<cwd>/.claude/commands/*.md` (Claude Code compatible)
- `~/.robota/skills/*/SKILL.md`
- `<cwd>/.agents/skills/*/SKILL.md`

### query()

```typescript
import { query } from '@robota-sdk/agent-sdk';

const response = await query('Show me the file list');

const response = await query('Analyze the code', {
  cwd: '/path/to/project',
  permissionMode: 'acceptEdits',
  maxTurns: 10,
  onTextDelta: (delta) => process.stdout.write(delta),
  onCompact: () => console.log('Context compacted'),
});
```

### createSession()

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

### Built-in Tools

`@robota-sdk/agent-sdk` re-exports 6 of the 8 built-in tools from `@robota-sdk/agent-tools`:

```typescript
import { bashTool, readTool, writeTool, editTool, globTool, grepTool } from '@robota-sdk/agent-sdk';
```

`webFetchTool` and `webSearchTool` are **not** re-exported from `@robota-sdk/agent-sdk`. Import them directly from the owning package:

```typescript
import { webFetchTool, webSearchTool } from '@robota-sdk/agent-tools';
```

## Subagent Sessions

`createSubagentSession()` creates an isolated child session for delegating subtasks. The subagent receives pre-resolved config and context from the parent — it does not load config files or context from disk.

```typescript
import { createSubagentSession } from '@robota-sdk/agent-sdk';

const subSession = createSubagentSession({
  parentSession: session,
  agentDefinition: 'explore',
  prompt: 'Analyze the test coverage gaps',
});
const result = await subSession.run();
```

### Agent Definitions

`IAgentDefinition` describes a reusable agent configuration (system prompt, allowed tools, permission mode). Custom agents are discovered from `.robota/agents/` (project), `.claude/agents/` (Claude Code compatible), and `~/.robota/agents/` (user). `AgentDefinitionLoader` is an internal class — it is not part of the public API.

Built-in agents: `general-purpose` (full tool access), `Explore` (read-only, Haiku model), `Plan` (read-only planning).

### createAgentTool()

`createAgentTool()` wraps subagent creation into a tool the AI can invoke directly. The parent session's hooks, permissions, and context are forwarded to the child.

## Hook Executors (SDK-Specific)

`agent-sdk` provides two `IHookTypeExecutor` implementations beyond the `command` and `http` executors in `agent-core`:

| Executor         | Hook Type | Description                                                               |
| ---------------- | --------- | ------------------------------------------------------------------------- |
| `PromptExecutor` | `prompt`  | Injects the hook's prompt text into the session as a system instruction   |
| `AgentExecutor`  | `agent`   | Creates a sub-agent session to process the hook input and return a result |

## Bundle Plugin System

Bundle plugins package reusable extensions (tools, hooks, permissions, system prompt additions) into installable units.

### Types

| Type                    | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `IBundlePluginManifest` | Plugin metadata: name, version, description, author, keywords   |
| `ILoadedBundlePlugin`   | Full bundle: manifest + tools, hooks, permissions, systemPrompt |

### BundlePluginLoader

Loads a bundle plugin from a directory path. Reads the manifest, resolves tool/hook definitions, and validates the bundle structure.

### BundlePluginInstaller

Manages plugin installation and uninstallation:

- Installs bundles to `~/.robota/plugins/` (user) or `.robota/plugins/` (project)
- Tracks installed plugins in a registry file
- Handles enable/disable state per plugin

## Configuration

Settings are loaded from (highest priority first):

| Layer | Path                              | Scope                                |
| ----- | --------------------------------- | ------------------------------------ |
| 1     | CLI flags / environment variables | Invocation                           |
| 2     | `.robota/settings.local.json`     | Project (local)                      |
| 3     | `.robota/settings.json`           | Project                              |
| 4     | `.claude/settings.json`           | Project (Claude Code compatible)     |
| 5     | `~/.robota/settings.json`         | User global                          |
| 6     | `~/.claude/settings.json`         | User global (Claude Code compatible) |

`$ENV:VAR` substitution is applied after merge.

```json
{
  "defaultMode": "default",
  "provider": {
    "name": "anthropic",
    "model": "claude-sonnet-4-6",
    "apiKey": "$ENV:ANTHROPIC_API_KEY"
  },
  "permissions": {
    "allow": ["Bash(pnpm *)"],
    "deny": ["Bash(rm -rf *)"]
  }
}
```

## Permission Modes

| Mode                | Read/Glob/Grep | Write/Edit |  Bash   |
| ------------------- | :------------: | :--------: | :-----: |
| `plan`              |      auto      |    deny    |  deny   |
| `default`           |      auto      |  approve   | approve |
| `acceptEdits`       |      auto      |    auto    | approve |
| `bypassPermissions` |      auto      |    auto    |  auto   |

## Dependencies

| Package                                | Purpose                               |
| -------------------------------------- | ------------------------------------- |
| `@robota-sdk/agent-core`               | Engine, providers, permissions, hooks |
| `@robota-sdk/agent-sessions`           | Session, SessionStore                 |
| `@robota-sdk/agent-tools`              | Tool infrastructure + built-in tools  |
| `@robota-sdk/agent-provider-anthropic` | Anthropic LLM provider                |
| `chalk`                                | Terminal colors (permission prompt)   |
| `zod`                                  | Settings schema validation            |

## Documentation

See [docs/SPEC.md](./docs/SPEC.md) for the full specification, architecture details, and design decisions.

## License

MIT
