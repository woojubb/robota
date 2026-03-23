# Subagent Execution Design

## Overview

Implement subagent execution for Robota CLI — enabling skills, commands, and custom agents to spawn isolated child sessions via the `Agent` tool. Matches Claude Code's subagent system.

## Architecture

```
Parent Session
  ├── AI calls Agent tool (tool_use)
  ├── createSubagentSession() assembles child session
  │     ├── Filtered tools (inherited + tools/disallowedTools)
  │     ├── Model override (from agent definition)
  │     ├── Framework system prompt + agent definition body
  │     └── CLAUDE.md/AGENTS.md loaded
  ├── Child session runs in isolated context
  ├── Child's final response → tool_result (verbatim)
  └── Parent receives result, continues conversation
```

**Package responsibilities:**

| Package        | Role                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| agent-core     | `Agent` tool definition                                                                                |
| agent-sdk      | `createSubagentSession()` — assembles child session with tool filtering, model override, system prompt |
| agent-sessions | Session runs as-is (no parent/child awareness needed)                                                  |
| agent-cli      | Agent definition loading (agents/ directory), `Agent` tool registration                                |

## 1. Agent Tool

Registered as a standard tool in the parent session's tool list. The parent AI calls it like any other tool.

### Tool Schema

```typescript
{
  name: 'Agent',
  description: 'Launch a subagent to handle a task in an isolated context. The subagent gets its own context window and returns a result when done.',
  parameters: {
    prompt: { type: 'string', description: 'The task for the subagent to perform' },
    subagent_type: { type: 'string', description: 'Agent type: "general-purpose", "Explore", "Plan", or a custom agent name from agents/ directory' },
    model: { type: 'string', description: 'Optional model override (e.g., "sonnet", "opus", "haiku")' },
  }
}
```

### Execution Flow

1. Parent AI outputs `tool_use` with `name: "Agent"`
2. Tool executor calls `createSubagentSession(options)`
3. Child session runs: `session.run(prompt)`
4. Child's final response text becomes the `tool_result`
5. Parent AI receives the result and continues

## 2. createSubagentSession (agent-sdk)

```typescript
interface ISubagentOptions {
  /** The parent session's resolved config */
  parentConfig: IResolvedConfig;
  /** The parent session's loaded context (CLAUDE.md, AGENTS.md) */
  parentContext: ILoadedContext;
  /** Agent definition (from agents/ directory or built-in) */
  agentDefinition: IAgentDefinition;
  /** Parent session's available tools (to inherit) */
  parentTools: IToolWithEventService[];
  /** Terminal output interface */
  terminal: ITerminalOutput;
  /** Permission handler from parent */
  permissionHandler?: TPermissionHandler;
  /** Streaming callback */
  onTextDelta?: (delta: string) => void;
  /** Tool execution callback */
  onToolExecution?: (event: IToolExecutionEvent) => void;
}

function createSubagentSession(options: ISubagentOptions): Session;
```

Responsibilities:

- **Tool filtering**: Apply `agentDefinition.tools` (allowlist) or `agentDefinition.disallowedTools` (denylist) to parent tools
- **Model override**: Use `agentDefinition.model` if specified, otherwise inherit parent model
- **System prompt assembly**: Framework instructions + agent definition body + CLAUDE.md
- **maxTurns**: Use `agentDefinition.maxTurns` if specified, otherwise default (10)
- No config file loading — all config comes from parent

## 3. Agent Definitions

### Built-in Agent Types

| Type              | Model   | Tools                            | System Prompt                          |
| ----------------- | ------- | -------------------------------- | -------------------------------------- |
| `general-purpose` | Inherit | All (inherit parent)             | Generic task execution instructions    |
| `Explore`         | Haiku   | Read-only (disallow Write, Edit) | Codebase exploration, search, analysis |
| `Plan`            | Inherit | Read-only (disallow Write, Edit) | Planning, research, architecture       |

### Custom Agent Format

Loaded from `agents/` directories: `.claude/agents/`, `~/.robota/agents/`, plugin `agents/`.

```markdown
---
name: security-reviewer
description: Reviews code for security vulnerabilities
model: sonnet
maxTurns: 20
disallowedTools: Write, Edit, Bash
---

You are a security code reviewer. Analyze the provided code for...
```

### Supported Frontmatter Fields

| Field             | Type   | Description                                                 |
| ----------------- | ------ | ----------------------------------------------------------- |
| `name`            | string | Agent identifier                                            |
| `description`     | string | What this agent does (used for AI delegation)               |
| `model`           | string | Model override: `sonnet`, `opus`, `haiku`, or full model ID |
| `maxTurns`        | number | Max agentic turns before forced stop                        |
| `tools`           | string | Comma-separated allowlist of tools                          |
| `disallowedTools` | string | Comma-separated denylist of tools                           |

### IAgentDefinition Interface

```typescript
interface IAgentDefinition {
  name: string;
  description: string;
  systemPrompt: string; // Markdown body
  model?: string;
  maxTurns?: number;
  tools?: string[]; // Allowlist
  disallowedTools?: string[]; // Denylist
}
```

## 4. Framework System Prompt Injection

When assembling the subagent's system prompt, the following are prepended/appended to the agent definition body:

### Subagent Suffix (appended)

```
When you complete the task, respond with a concise report covering what was done and any key findings — the caller will relay this to the user, so it only needs the essentials.

In your final response, share file paths (always absolute, never relative) that are relevant to the task. Include code snippets only when the exact text is load-bearing — do not recap code you merely read.
```

### Fork Worker Suffix (for context: fork skills, appended)

```
You are a worker subagent executing a specific task. Do NOT spawn sub-agents; execute directly. Keep your report under 500 words. Use this structure:
- Scope: What was requested
- Result: What was done
- Key files: Relevant file paths (absolute)
- Files changed: List of modifications
- Issues: Any problems encountered
```

### Assembly Order

1. Agent definition markdown body (or built-in system prompt)
2. CLAUDE.md / AGENTS.md content
3. Framework suffix (subagent or fork worker)

## 5. Tool Filtering

```typescript
function filterTools(
  parentTools: IToolWithEventService[],
  agentDef: IAgentDefinition,
): IToolWithEventService[] {
  let tools = [...parentTools];

  // Apply denylist first
  if (agentDef.disallowedTools?.length) {
    tools = tools.filter((t) => !agentDef.disallowedTools!.includes(t.name));
  }

  // Apply allowlist (if specified, restrict to only these)
  if (agentDef.tools?.length) {
    tools = tools.filter((t) => agentDef.tools!.includes(t.name));
  }

  // Always include the Agent tool itself? NO — subagents cannot spawn subagents
  tools = tools.filter((t) => t.name !== 'Agent');

  return tools;
}
```

## 6. Skill/Command Integration (context: fork)

When a skill with `context: fork` is invoked:

1. `buildSkillPrompt` processes the skill content (variable substitution, shell preprocessing)
2. Instead of sending to parent session, creates a subagent:
   - Agent type from skill's `agent` field (default: `general-purpose`)
   - Skill content becomes the subagent prompt
   - Fork worker suffix is used instead of standard subagent suffix
3. Subagent executes and returns result
4. Result is displayed to user as the skill's response

This replaces the current `ISkillExecutionCallbacks.runInFork` callback with actual subagent execution.

## 7. Transcript Storage

Subagent transcripts are stored separately:

```
~/.robota/sessions/{parentSessionId}/subagents/agent-{agentId}.jsonl
```

Each subagent gets a unique `agentId` (format: `agent_{timestamp}_{random}`).

## 8. Constraints

- **No nesting**: Subagents cannot spawn other subagents (Agent tool excluded from subagent's tool list)
- **No parent history**: Subagent receives only its prompt and system instructions, not parent conversation
- **Foreground only** (Phase 1): Parent waits for subagent completion. Background execution deferred.
- **No resumption** (Phase 1): Subagent runs to completion. SendMessage/resumption deferred.

## 9. Implementation Order

1. **Agent definition loading** — parse agents/ directories, built-in types
2. **createSubagentSession** — session assembly with tool filtering, model override, system prompt
3. **Agent tool** — register tool, wire execution to createSubagentSession
4. **context: fork wiring** — connect skill fork execution to Agent tool
5. **Transcript storage** — save subagent logs
6. **Tests** — unit + integration for each component
