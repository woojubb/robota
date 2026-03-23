# @robota-sdk/agent-sdk

Programmatic SDK for building AI agents with Robota. Provides a single `query()` entry point along with Session management, built-in tools, permissions, hooks, streaming, and context loading.

This is the **assembly layer** of the Robota ecosystem -- it composes lower-level packages (`agent-core`, `agent-tools`, `agent-sessions`) into a cohesive SDK.

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

- **query()** -- Single entry point for AI agent interactions with streaming support
- **Session** -- Wraps the Robota engine with permission checks, tool wiring, history, and streaming
- **Built-in Tools** -- Bash, Read, Write, Edit, Glob, Grep (from `@robota-sdk/agent-tools`)
- **Agent Tool** -- Sub-agent session creation for multi-agent workflows
- **Permissions** -- 3-step evaluation (deny list, allow list, mode policy) with four modes: `plan`, `default`, `acceptEdits`, `bypassPermissions`
- **Hooks** -- `PreToolUse`, `PostToolUse`, `SessionStart`, `Stop` events with shell command execution
- **Streaming** -- Real-time text delta callbacks via `onTextDelta`
- **Context Loading** -- AGENTS.md / CLAUDE.md walk-up discovery and system prompt assembly
- **Config Loading** -- 3-layer merge (user global, project, local) with `$ENV:VAR` substitution
- **Context Window Management** -- Token tracking, auto-compaction at ~83.5%, manual `session.compact()`

## Architecture

```
agent-sdk (assembly layer)
  -> agent-sessions  (Session, SessionStore)
  -> agent-tools     (tool infrastructure + 6 built-in tools)
  -> agent-core      (Robota engine, providers, permissions, hooks)
```

`agent-sdk` assembles existing packages -- it does not re-implement functionality that belongs in lower layers.

## Subagent Sessions

`createSubagentSession()` creates a child session for delegating subtasks. The subagent forks the parent's context, inherits hooks and permissions, and runs with its own conversation history.

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

`IAgentDefinition` describes a reusable agent configuration (system prompt, allowed tools, permission mode). `AgentDefinitionLoader` discovers definitions from `.claude/agents/` and built-in defaults.

Built-in agents: `explore` (read-only), `plan` (read-only planning), and a general-purpose agent with full tool access.

### createAgentTool

`createAgentTool()` wraps subagent creation into a tool that the AI can invoke directly. The parent session's hooks, permissions, and context are forwarded to the child. The tool assembles the subagent prompt from the agent definition and the caller's instructions.

## Session Usage

```typescript
import { Session } from '@robota-sdk/agent-sessions';

const session = new Session({ config, context, terminal, permissionMode });
const response = await session.run('Hello');
session.getHistory();
session.clearHistory();
```

## Documentation

See [docs/SPEC.md](./docs/SPEC.md) for the full specification, architecture details, and design decisions.

## License

MIT
