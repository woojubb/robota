# Subagent Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the parent AI to spawn isolated subagent sessions via an `Agent` tool, with tool filtering, model override, and framework system prompt injection.

**Architecture:** `Agent` tool registered in agent-sdk, calls `createSubagentSession()` which assembles a child Session with filtered tools and custom system prompt. Child session runs to completion and returns its final response as the tool result. No parent/child coupling in agent-sessions.

**Tech Stack:** TypeScript, Vitest, agent-core (tool interface), agent-sdk (assembly), agent-sessions (Session runtime)

**Spec:** `docs/superpowers/specs/2026-03-23-subagent-execution-design.md`

---

## File Structure

### agent-sdk (assembly + agent definitions)

| File                                                         | Action | Responsibility                                                                     |
| ------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------- |
| `packages/agent-sdk/src/agents/agent-definition-types.ts`    | Create | `IAgentDefinition` interface, built-in agent configs                               |
| `packages/agent-sdk/src/agents/agent-definition-loader.ts`   | Create | Load agent definitions from agents/ directories, parse frontmatter                 |
| `packages/agent-sdk/src/agents/built-in-agents.ts`           | Create | Built-in agent definitions (Explore, Plan, general-purpose)                        |
| `packages/agent-sdk/src/agents/index.ts`                     | Create | Re-exports                                                                         |
| `packages/agent-sdk/src/assembly/create-subagent-session.ts` | Create | `createSubagentSession()` — tool filtering, model override, system prompt assembly |
| `packages/agent-sdk/src/assembly/subagent-prompts.ts`        | Create | Framework system prompt suffixes (subagent, fork worker)                           |
| `packages/agent-sdk/src/tools/agent-tool.ts`                 | Modify | Register Agent tool                                                                |
| `packages/agent-sdk/src/index.ts`                            | Modify | Export new modules                                                                 |

### agent-cli (wiring)

| File                                                    | Action | Responsibility                      |
| ------------------------------------------------------- | ------ | ----------------------------------- |
| `packages/agent-cli/src/ui/hooks/useSession.ts`         | Modify | Pass agent tool to session          |
| `packages/agent-cli/src/ui/hooks/useCommandRegistry.ts` | Modify | Load agent definitions from plugins |
| `packages/agent-cli/src/commands/skill-executor.ts`     | Modify | Wire context:fork to Agent tool     |

---

## Task 1: Agent Definition Types and Built-in Agents

**Files:**

- Create: `packages/agent-sdk/src/agents/agent-definition-types.ts`
- Create: `packages/agent-sdk/src/agents/built-in-agents.ts`
- Create: `packages/agent-sdk/src/agents/index.ts`
- Test: `packages/agent-sdk/src/agents/__tests__/built-in-agents.test.ts`

- [ ] **Step 1: Write failing test for IAgentDefinition and built-in agents**

```typescript
import { describe, it, expect } from 'vitest';
import { getBuiltInAgent, BUILT_IN_AGENTS } from '../built-in-agents.js';

describe('Built-in agents', () => {
  it('should have general-purpose, Explore, and Plan', () => {
    expect(BUILT_IN_AGENTS).toHaveLength(3);
    expect(BUILT_IN_AGENTS.map((a) => a.name)).toEqual(['general-purpose', 'Explore', 'Plan']);
  });

  it('should return agent by name', () => {
    const explore = getBuiltInAgent('Explore');
    expect(explore).toBeDefined();
    expect(explore!.model).toBe('claude-haiku-4-5');
    expect(explore!.disallowedTools).toContain('Write');
    expect(explore!.disallowedTools).toContain('Edit');
  });

  it('should return undefined for unknown agent', () => {
    expect(getBuiltInAgent('nonexistent')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-sdk && pnpm test -- --run src/agents/__tests__/built-in-agents.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement types and built-in agents**

`agent-definition-types.ts`:

```typescript
export interface IAgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  model?: string;
  maxTurns?: number;
  tools?: string[];
  disallowedTools?: string[];
}
```

`built-in-agents.ts`:

```typescript
export const BUILT_IN_AGENTS: IAgentDefinition[] = [
  {
    name: 'general-purpose',
    description: 'General-purpose agent for complex multi-step tasks',
    systemPrompt: 'You are a general-purpose agent...',
  },
  {
    name: 'Explore',
    description: 'Fast agent for codebase exploration and search',
    systemPrompt: 'You are a read-only exploration agent...',
    model: 'claude-haiku-4-5',
    disallowedTools: ['Write', 'Edit'],
  },
  {
    name: 'Plan',
    description: 'Planning and research agent',
    systemPrompt: 'You are a planning agent...',
    disallowedTools: ['Write', 'Edit'],
  },
];

export function getBuiltInAgent(name: string): IAgentDefinition | undefined {
  return BUILT_IN_AGENTS.find((a) => a.name === name);
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent-sdk): add IAgentDefinition types and built-in agents"
```

---

## Task 2: Agent Definition Loader

**Files:**

- Create: `packages/agent-sdk/src/agents/agent-definition-loader.ts`
- Test: `packages/agent-sdk/src/agents/__tests__/agent-definition-loader.test.ts`

- [ ] **Step 1: Write failing test for loading agent definitions from markdown files**

```typescript
describe('AgentDefinitionLoader', () => {
  it('should parse agent markdown with frontmatter', () => {
    // Create temp dir with agents/security-reviewer.md
    // Frontmatter: name, description, model, disallowedTools
    // Body: system prompt text
    // Verify IAgentDefinition fields
  });

  it('should load from multiple directories with priority', () => {
    // .claude/agents/ > ~/.robota/agents/ > plugin agents/
  });

  it('should merge built-in agents with custom agents', () => {
    // Custom agent with same name overrides built-in
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement AgentDefinitionLoader**

Parse markdown frontmatter (reuse existing `parseSkillFrontmatter` pattern). Scan directories: `.claude/agents/`, `~/.robota/agents/`, plugin `agents/`. Merge with built-in agents.

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent-sdk): add AgentDefinitionLoader for custom agent definitions"
```

---

## Task 3: Framework System Prompt Suffixes

**Files:**

- Create: `packages/agent-sdk/src/assembly/subagent-prompts.ts`
- Test: `packages/agent-sdk/src/assembly/__tests__/subagent-prompts.test.ts`

- [ ] **Step 1: Write failing test for prompt suffix generation**

```typescript
describe('Subagent prompts', () => {
  it('should generate subagent suffix', () => {
    const suffix = getSubagentSuffix();
    expect(suffix).toContain('concise report');
    expect(suffix).toContain('absolute');
  });

  it('should generate fork worker suffix', () => {
    const suffix = getForkWorkerSuffix();
    expect(suffix).toContain('500 words');
    expect(suffix).toContain('Scope');
  });

  it('should assemble full subagent system prompt', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'You are a reviewer.',
      claudeMd: '# Project rules',
      agentsMd: '# Agent rules',
      isForkWorker: false,
    });
    expect(prompt).toContain('You are a reviewer.');
    expect(prompt).toContain('# Project rules');
    expect(prompt).toContain('concise report');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement subagent-prompts.ts**

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent-sdk): add subagent framework system prompt suffixes"
```

---

## Task 4: createSubagentSession

**Files:**

- Create: `packages/agent-sdk/src/assembly/create-subagent-session.ts`
- Test: `packages/agent-sdk/src/__tests__/create-subagent-session.test.ts`

- [ ] **Step 1: Write failing test for subagent session creation**

```typescript
describe('createSubagentSession', () => {
  it('should create a session with filtered tools', () => {
    // Agent with disallowedTools: ['Write', 'Edit']
    // Verify Write and Edit are not in session tools
  });

  it('should override model from agent definition', () => {
    // Agent with model: 'claude-haiku-4-5'
    // Verify session uses haiku model
  });

  it('should exclude Agent tool from subagent', () => {
    // Verify Agent tool is not in subagent's tool list
  });

  it('should inject framework system prompt', () => {
    // Verify system prompt contains agent body + framework suffix
  });

  it('should inherit parent config when no override', () => {
    // No model override → uses parent model
    // No tool restriction → inherits all parent tools (minus Agent)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement createSubagentSession**

```typescript
export function createSubagentSession(options: ISubagentOptions): Session {
  // 1. Resolve model (agent override or parent)
  // 2. Filter tools (disallowedTools, tools allowlist, exclude Agent)
  // 3. Assemble system prompt (agent body + CLAUDE.md + framework suffix)
  // 4. Create Session with filtered tools, model, system prompt
  return new Session({ ... });
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent-sdk): add createSubagentSession with tool filtering and prompt assembly"
```

---

## Task 5: Agent Tool

**Files:**

- Modify: `packages/agent-sdk/src/tools/agent-tool.ts` (or create if needed)
- Test: `packages/agent-sdk/src/tools/__tests__/agent-tool.test.ts`

- [ ] **Step 1: Write failing test for Agent tool**

```typescript
describe('Agent tool', () => {
  it('should have correct name and parameters', () => {
    expect(agentTool.name).toBe('Agent');
    expect(agentTool.parameters).toHaveProperty('prompt');
    expect(agentTool.parameters).toHaveProperty('subagent_type');
  });

  it('should create subagent session and return result', async () => {
    // Mock createSubagentSession to return a mock session
    // Mock session.run to return 'task completed'
    // Verify tool result contains 'task completed'
  });

  it('should resolve agent definition by name', async () => {
    // subagent_type: 'Explore' → resolves to built-in Explore agent
    // Verify session created with haiku model and read-only tools
  });

  it('should include agentId in result', async () => {
    // Verify result contains agentId for potential resumption
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement Agent tool**

The tool executor:

1. Resolve `subagent_type` to `IAgentDefinition` (built-in or custom)
2. Call `createSubagentSession()`
3. Call `session.run(prompt)`
4. Return `{ success: true, output: response, agentId }`

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent-sdk): add Agent tool for subagent execution"
```

---

## Task 6: Wire Agent Tool into CLI

**Files:**

- Modify: `packages/agent-cli/src/ui/hooks/useSession.ts`
- Modify: `packages/agent-sdk/src/assembly/create-session.ts`

- [ ] **Step 1: Register Agent tool in createSession**

Add Agent tool to the default tools list in `createSession`. The tool needs access to parent session's config, context, provider, and tools — pass these via closure or DI.

- [ ] **Step 2: Verify CLI loads Agent tool**

Run CLI, check `/help` or system prompt includes Agent tool.

- [ ] **Step 3: Test end-to-end**

In CLI, ask AI to use the Agent tool (e.g., "Use the Explore agent to find all test files").

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(agent-cli): wire Agent tool into session creation"
```

---

## Task 7: context:fork Wiring

**Files:**

- Modify: `packages/agent-cli/src/commands/skill-executor.ts`
- Modify: `packages/agent-cli/src/ui/hooks/useSubmitHandler.ts`

- [ ] **Step 1: Replace callback-based fork with Agent tool execution**

When a skill has `context: fork`:

1. Resolve agent type from skill's `agent` field
2. Create subagent session via `createSubagentSession`
3. Run skill content as the subagent's prompt
4. Return result to parent

- [ ] **Step 2: Test context:fork skill execution**

Create a test skill with `context: fork` and verify it runs in isolated subagent.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(agent-cli): wire context:fork skills to subagent execution"
```

---

## Task 8: Transcript Storage

**Files:**

- Create: `packages/agent-sdk/src/assembly/subagent-logger.ts`

- [ ] **Step 1: Implement subagent transcript storage**

Save subagent session logs to `~/.robota/sessions/{parentSessionId}/subagents/agent-{agentId}.jsonl`

- [ ] **Step 2: Wire into createSubagentSession**

Pass subagent logger as `sessionLogger` option.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(agent-sdk): add subagent transcript storage"
```

---

## Task 9: Integration Tests and Build Verification

**Files:**

- Test: `packages/agent-sdk/src/__tests__/subagent-integration.test.ts`

- [ ] **Step 1: Write integration test for full subagent flow**

Agent tool call → subagent session created → runs → returns result → parent receives tool_result.

- [ ] **Step 2: Write integration test for Explore agent**

Verify read-only tools, haiku model.

- [ ] **Step 3: Run full build and test suite**

```bash
pnpm build && pnpm test && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git commit -m "test: add subagent execution integration tests"
```

---

## Task 10: Update SPEC.md Documentation

**Files:**

- Modify: `packages/agent-sdk/docs/SPEC.md`
- Modify: `packages/agent-cli/docs/SPEC.md`

- [ ] **Step 1: Update agent-sdk SPEC**

Add: createSubagentSession, Agent tool, agent definitions, framework prompts.

- [ ] **Step 2: Update agent-cli SPEC**

Add: Agent tool registration, context:fork wiring, agent definition loading.

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: update SPECs for subagent execution"
```
