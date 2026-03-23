# Using the SDK

`@robota-sdk/agent-sdk` is the assembly layer that composes `agent-core`, `agent-tools`, `agent-sessions`, and `agent-provider-anthropic` into a cohesive experience. It provides configuration loading, project context discovery, and the `query()` / `createSession()` entry points.

## query() — One-Shot API

The simplest way to interact with Robota. Handles config, context, session creation, and cleanup automatically.

```typescript
import { query } from '@robota-sdk/agent-sdk';

const response = await query('List all TypeScript files in this project');
```

### Options

```typescript
const response = await query('Refactor this function', {
  cwd: '/path/to/project', // Working directory (default: process.cwd())
  permissionMode: 'acceptEdits', // Permission mode for tool execution
  maxTurns: 10, // Limit agentic turns
  onTextDelta: (delta) => {
    // Streaming callback
    process.stdout.write(delta);
  },
  onCompact: (summary) => {
    // Compaction notification
    console.log('Context compacted');
  },
});
```

## createSession() — Full Control

For interactive use cases where you need multiple turns with the same session.

```typescript
import { createSession, loadConfig, loadContext, detectProject } from '@robota-sdk/agent-sdk';

const cwd = process.cwd();
const [config, context, projectInfo] = await Promise.all([
  loadConfig(cwd),
  loadContext(cwd),
  detectProject(cwd),
]);

const session = createSession({
  config,
  context,
  terminal,
  projectInfo,
  permissionMode: 'default',
  onTextDelta: (delta) => process.stdout.write(delta),
});

// Multi-turn conversation
const r1 = await session.run('What files are in src/?');
const r2 = await session.run('Show me the largest one.');

// Session state
console.log(session.getContextState()); // { usedTokens, maxTokens, usedPercentage }
console.log(session.getPermissionMode()); // 'default'
console.log(session.getMessageCount()); // 2
```

## Configuration

Config is loaded from 3 layers (later overrides earlier):

1. **User global**: `~/.robota/settings.json`
2. **Project**: `.robota/settings.json`
3. **Local override**: `.robota/settings.local.json` (gitignored)

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

Sessions created by `createSession()` include:

| Feature                    | Description                                                            |
| -------------------------- | ---------------------------------------------------------------------- |
| **Permission enforcement** | Tool calls are gated by the permission system                          |
| **Hook execution**         | PreToolUse/PostToolUse/PreCompact/PostCompact hooks fire automatically |
| **Context tracking**       | Token usage is tracked and available via `getContextState()`           |
| **Auto-compaction**        | Context is compressed when usage exceeds ~83.5%                        |
| **Session persistence**    | Conversations can be saved/loaded via `SessionStore`                   |
| **Abort**                  | Cancel a running `run()` call with `session.abort()`                   |

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

### Agent Definitions

Agent definitions describe reusable agent configurations. Built-in types:

| Type      | Purpose                                     |
| --------- | ------------------------------------------- |
| `explore` | Read-only codebase exploration              |
| `plan`    | Multi-step planning with read-only tools    |
| (custom)  | General-purpose agent with full tool access |

Custom agent definitions can be placed in `.claude/agents/` and are loaded by `AgentDefinitionLoader`. See [agent-sdk SPEC.md](../../packages/agent-sdk/docs/SPEC.md) for the `IAgentDefinition` interface.

## Always-Streaming Policy

The Anthropic provider always uses the streaming API internally, even when no `onTextDelta` callback is provided. This avoids the 10-minute HTTP timeout that can occur with long-running tool loops on non-streaming requests. The final response text is assembled from the stream. See [agent-provider-anthropic SPEC.md](../../packages/agent-provider-anthropic/docs/SPEC.md) for details.

## Assembly vs Direct Usage

| Use case                | Approach                                                           |
| ----------------------- | ------------------------------------------------------------------ |
| Quick one-shot          | `query()` — handles everything                                     |
| Interactive multi-turn  | `createSession()` — full session lifecycle                         |
| Custom agent (no SDK)   | `new Robota()` from `agent-core` directly                          |
| Custom session (no SDK) | `new Session()` from `agent-sessions` with your own tools/provider |
