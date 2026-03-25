# @robota-sdk/agent-sdk

Programmatic SDK for building AI agents with Robota. Provides a single `query()` entry point along with session management, built-in tools, permissions, hooks, streaming, and context loading.

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

- **query()** — Single entry point for AI agent interactions with streaming support
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
  -> agent-sessions  (Session, SessionStore)
  -> agent-tools     (tool infrastructure + 8 built-in tools)
  -> agent-provider-anthropic (Anthropic LLM provider)
  -> agent-core      (Robota engine, providers, permissions, hooks)
```

`agent-sdk` assembles existing packages — it does not re-implement functionality that belongs in lower layers.

## API

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
