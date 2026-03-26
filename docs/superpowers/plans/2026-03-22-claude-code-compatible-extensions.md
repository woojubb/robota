# Claude Code Compatible Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement four Claude Code-compatible extension systems (Skill/Command, Hook, BundlePlugin, Marketplace) in Robota CLI so Claude Code ecosystem resources work natively.

**Architecture:** Extend existing `SkillCommandSource` for multi-path skill discovery with Claude Code frontmatter schema. Upgrade hook runner with strategy pattern for 4 hook types (`command`/`http` in core, `prompt`/`agent` in sdk). Add `BundlePlugin` to agent-sdk for directory-based plugin management. Add marketplace source management for plugin discovery/installation.

**Tech Stack:** TypeScript, Vitest, Zod (validation), child_process (hook command), fetch (http hooks/marketplace)

**Spec:** `docs/superpowers/specs/2026-03-22-claude-code-compatible-extensions-design.md`

---

## File Structure

### agent-core (hooks upgrade)

| File                                                          | Action | Responsibility                                                                  |
| ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `packages/agent-core/src/hooks/types.ts`                      | Modify | Add new events, discriminated union for hook types, IHookTypeExecutor interface |
| `packages/agent-core/src/hooks/hook-runner.ts`                | Modify | Strategy pattern for hook type executors, http executor, configurable timeout   |
| `packages/agent-core/src/hooks/executors/command-executor.ts` | Create | Extract command execution from hook-runner                                      |
| `packages/agent-core/src/hooks/executors/http-executor.ts`    | Create | HTTP POST hook executor                                                         |
| `packages/agent-core/src/hooks/executors/index.ts`            | Create | Re-export executors                                                             |
| `packages/agent-core/src/hooks/index.ts`                      | Modify | Re-export new types and executors                                               |

### agent-sdk (config, hooks wiring, BundlePlugin, marketplace)

| File                                                        | Action | Responsibility                                               |
| ----------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| `packages/agent-sdk/src/config/config-loader.ts`            | Modify | Add `.claude/settings.json` loading                          |
| `packages/agent-sdk/src/config/config-types.ts`             | Modify | Add hook type union, BundlePlugin config, marketplace config |
| `packages/agent-sdk/src/hooks/prompt-executor.ts`           | Create | LLM-based hook executor                                      |
| `packages/agent-sdk/src/hooks/agent-executor.ts`            | Create | Subagent hook executor                                       |
| `packages/agent-sdk/src/hooks/index.ts`                     | Create | Register sdk-level executors                                 |
| `packages/agent-sdk/src/plugins/bundle-plugin-loader.ts`    | Create | Discover, validate, load BundlePlugins                       |
| `packages/agent-sdk/src/plugins/bundle-plugin-types.ts`     | Create | BundlePlugin interfaces and schemas                          |
| `packages/agent-sdk/src/plugins/bundle-plugin-installer.ts` | Create | Install/uninstall plugins from marketplace                   |
| `packages/agent-sdk/src/plugins/marketplace-client.ts`      | Create | Marketplace source management, manifest fetch                |
| `packages/agent-sdk/src/plugins/index.ts`                   | Create | Re-export plugin types and loaders                           |
| `packages/agent-sdk/src/context/system-prompt-builder.ts`   | Modify | Inject discovered skill list                                 |
| `packages/agent-sdk/src/assembly/create-session.ts`         | Modify | Wire hook config, register sdk executors                     |

### agent-cli (skill discovery, commands, UI)

| File                                                | Action | Responsibility                               |
| --------------------------------------------------- | ------ | -------------------------------------------- |
| `packages/agent-cli/src/commands/skill-source.ts`   | Modify | Multi-path scan, full frontmatter parsing    |
| `packages/agent-cli/src/commands/types.ts`          | Modify | Extend ISlashCommand with Claude Code fields |
| `packages/agent-cli/src/commands/slash-executor.ts` | Modify | Add /plugin command handler                  |
| `packages/agent-cli/src/commands/builtin-source.ts` | Modify | Register /plugin command                     |
| `packages/agent-cli/src/commands/plugin-source.ts`  | Create | Discover skills from installed BundlePlugins |
| `packages/agent-cli/src/utils/skill-prompt.ts`      | Modify | Variable substitution ($ARGUMENTS, etc.)     |
| `packages/agent-cli/src/utils/settings-io.ts`       | Modify | Add .claude/settings.json read support       |

---

## Task 1: Upgrade Hook Types & Strategy Interface (agent-core)

**Files:**

- Modify: `packages/agent-core/src/hooks/types.ts`
- Test: `packages/agent-core/src/hooks/__tests__/types.test.ts`

- [ ] **Step 1: Write failing test for new hook events and discriminated union**

```typescript
import { describe, it, expect } from 'vitest';
import type { THookEvent, IHookDefinition, IHookTypeExecutor } from '../types.js';

describe('Hook types', () => {
  it('should include all Phase 1 events', () => {
    const events: THookEvent[] = [
      'PreToolUse',
      'PostToolUse',
      'SessionStart',
      'Stop',
      'PreCompact',
      'PostCompact',
      'UserPromptSubmit',
      'Notification',
    ];
    expect(events).toHaveLength(8);
  });

  it('should support discriminated union for hook definitions', () => {
    const commandHook: IHookDefinition = { type: 'command', command: 'echo test', timeout: 10 };
    const httpHook: IHookDefinition = { type: 'http', url: 'https://example.com', timeout: 5 };
    const promptHook: IHookDefinition = { type: 'prompt', prompt: 'Is this safe?' };
    const agentHook: IHookDefinition = {
      type: 'agent',
      agent: 'Explore',
      maxTurns: 10,
      timeout: 60,
    };

    expect(commandHook.type).toBe('command');
    expect(httpHook.type).toBe('http');
    expect(promptHook.type).toBe('prompt');
    expect(agentHook.type).toBe('agent');
  });

  it('should define IHookTypeExecutor interface', () => {
    const executor: IHookTypeExecutor = {
      type: 'command',
      execute: async (_definition, _input) => ({ exitCode: 0, stdout: '', stderr: '' }),
    };
    expect(executor.type).toBe('command');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-core && pnpm test -- --run src/hooks/__tests__/types.test.ts`
Expected: FAIL — new types don't exist yet

- [ ] **Step 3: Implement type changes**

Update `packages/agent-core/src/hooks/types.ts`:

- Expand `THookEvent` to include `UserPromptSubmit` and `Notification`
- Replace `IHookDefinition` with discriminated union (command, http, prompt, agent)
- Add `IHookTypeExecutor` strategy interface
- Update `THooksConfig` to use new `THookEvent`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent-core && pnpm test -- --run src/hooks/__tests__/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/hooks/types.ts packages/agent-core/src/hooks/__tests__/types.test.ts
git commit -m "feat(agent-core): expand hook types with discriminated union and strategy interface"
```

---

## Task 2: Extract Command Executor & Add HTTP Executor (agent-core)

**Files:**

- Create: `packages/agent-core/src/hooks/executors/command-executor.ts`
- Create: `packages/agent-core/src/hooks/executors/http-executor.ts`
- Create: `packages/agent-core/src/hooks/executors/index.ts`
- Modify: `packages/agent-core/src/hooks/hook-runner.ts`
- Test: `packages/agent-core/src/hooks/__tests__/command-executor.test.ts`
- Test: `packages/agent-core/src/hooks/__tests__/http-executor.test.ts`

- [ ] **Step 1: Write failing test for command executor**

```typescript
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../executors/command-executor.js';
import type { IHookInput } from '../types.js';

describe('CommandExecutor', () => {
  const executor = new CommandExecutor();

  it('should have type "command"', () => {
    expect(executor.type).toBe('command');
  });

  it('should execute shell command and return result', async () => {
    const definition = { type: 'command' as const, command: 'echo hello' };
    const input: IHookInput = {
      session_id: 'test',
      cwd: process.cwd(),
      hook_event_name: 'SessionStart',
    };
    const result = await executor.execute(definition, input);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
  });

  it('should respect timeout in seconds', async () => {
    const definition = { type: 'command' as const, command: 'sleep 10', timeout: 1 };
    const input: IHookInput = {
      session_id: 'test',
      cwd: process.cwd(),
      hook_event_name: 'SessionStart',
    };
    const result = await executor.execute(definition, input);
    expect(result.exitCode).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-core && pnpm test -- --run src/hooks/__tests__/command-executor.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement CommandExecutor**

Extract shell execution logic from current `hook-runner.ts` into `executors/command-executor.ts`. Implements `IHookTypeExecutor`. Timeout in seconds (convert to ms internally).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent-core && pnpm test -- --run src/hooks/__tests__/command-executor.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for HTTP executor**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { HttpExecutor } from '../executors/http-executor.js';
import type { IHookInput } from '../types.js';

describe('HttpExecutor', () => {
  const executor = new HttpExecutor();

  it('should have type "http"', () => {
    expect(executor.type).toBe('http');
  });

  it('should POST hook input to URL and return result', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const definition = { type: 'http' as const, url: 'https://example.com/hook' };
    const input: IHookInput = {
      session_id: 'test',
      cwd: '/tmp',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
    };
    const result = await executor.execute(definition, input);
    expect(result.exitCode).toBe(0);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({ method: 'POST' }),
    );

    vi.unstubAllGlobals();
  });

  it('should return exit code 2 when response has ok: false', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, reason: 'blocked' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const definition = { type: 'http' as const, url: 'https://example.com/hook' };
    const input: IHookInput = {
      session_id: 'test',
      cwd: '/tmp',
      hook_event_name: 'PreToolUse',
    };
    const result = await executor.execute(definition, input);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('blocked');

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd packages/agent-core && pnpm test -- --run src/hooks/__tests__/http-executor.test.ts`
Expected: FAIL

- [ ] **Step 7: Implement HttpExecutor**

Create `executors/http-executor.ts`. POSTs JSON input to URL, parses `{ok, reason}` response. Supports `headers` with env var interpolation. `ok: false` → exit code 2.

- [ ] **Step 8: Run tests to verify both pass**

Run: `cd packages/agent-core && pnpm test -- --run src/hooks/__tests__/http-executor.test.ts`
Expected: PASS

- [ ] **Step 9: Refactor hook-runner to use strategy pattern**

Modify `hook-runner.ts`:

- Accept `IHookTypeExecutor[]` as parameter
- Default to `[new CommandExecutor(), new HttpExecutor()]`
- Dispatch to matching executor by `definition.type`
- Unknown type → skip with warning

- [ ] **Step 10: Run all hook tests**

Run: `cd packages/agent-core && pnpm test -- --run src/hooks/`
Expected: All PASS

- [ ] **Step 11: Update hook index exports**

Modify `packages/agent-core/src/hooks/index.ts` to re-export executors and new types.

- [ ] **Step 12: Commit**

```bash
git add packages/agent-core/src/hooks/
git commit -m "feat(agent-core): extract command executor, add http executor, strategy pattern in hook runner"
```

---

## Task 3: Upgrade Config Loader for `.claude/settings.json` (agent-sdk)

**Files:**

- Modify: `packages/agent-sdk/src/config/config-loader.ts`
- Modify: `packages/agent-sdk/src/config/config-types.ts`
- Test: `packages/agent-sdk/src/__tests__/config-loader.test.ts`

- [ ] **Step 1: Write failing test for .claude/settings.json loading**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config-loader.js';
import * as fs from 'node:fs';

describe('Config loader with .claude/settings.json', () => {
  it('should load hooks from .claude/settings.json', async () => {
    // Test that .claude/settings.json hooks are loaded
    // and merged into config with correct priority
  });

  it('should prioritize .claude/settings.local.json over .claude/settings.json', async () => {
    // Test priority ordering
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-sdk && pnpm build:deps && pnpm test -- --run src/__tests__/config-loader.test.ts`
Expected: FAIL

- [ ] **Step 3: Update config-types.ts**

Add to `IResolvedConfig`:

- Full hook type discriminated union support
- `enabledPlugins` field
- `extraKnownMarketplaces` field

Update `HooksSchema` to include all Phase 1 events.

- [ ] **Step 4: Update config-loader.ts**

Add `.claude/settings.json` and `.claude/settings.local.json` to load precedence (later entries win, matching "later wins" merge semantics):

1. `~/.claude/settings.json` (user-level, lowest priority)
2. `.claude/settings.json` (project)
3. `.claude/settings.local.json` (project-local, gitignored, highest priority)

Legacy paths (`.robota/`) are loaded before `.claude/` paths so `.claude/` always wins.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/agent-sdk && pnpm test -- --run src/__tests__/config-loader.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agent-sdk/src/config/
git commit -m "feat(agent-sdk): load .claude/settings.json with hook and plugin config"
```

---

## Task 4: Prompt & Agent Hook Executors (agent-sdk)

**Files:**

- Create: `packages/agent-sdk/src/hooks/prompt-executor.ts`
- Create: `packages/agent-sdk/src/hooks/agent-executor.ts`
- Create: `packages/agent-sdk/src/hooks/index.ts`
- Test: `packages/agent-sdk/src/hooks/__tests__/prompt-executor.test.ts`
- Test: `packages/agent-sdk/src/hooks/__tests__/agent-executor.test.ts`

- [ ] **Step 1: Write failing test for prompt executor**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PromptExecutor } from '../prompt-executor.js';

describe('PromptExecutor', () => {
  it('should have type "prompt"', () => {
    const executor = new PromptExecutor(mockProviderFactory);
    expect(executor.type).toBe('prompt');
  });

  it('should call LLM and return ok/block based on response', async () => {
    // Mock provider that returns { ok: true }
    // Verify exit code 0
  });

  it('should return exit code 2 when LLM says not ok', async () => {
    // Mock provider that returns { ok: false, reason: 'unsafe' }
    // Verify exit code 2, stderr contains reason
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-sdk && pnpm build:deps && pnpm test -- --run src/hooks/__tests__/prompt-executor.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement PromptExecutor**

Takes a provider factory via constructor (DI). Makes single-turn LLM call with hook input context. Parses `{ok, reason}` from response. Respects `model` field in definition.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent-sdk && pnpm test -- --run src/hooks/__tests__/prompt-executor.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for agent executor**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AgentExecutor } from '../agent-executor.js';

describe('AgentExecutor', () => {
  it('should have type "agent"', () => {
    const executor = new AgentExecutor(mockSessionFactory);
    expect(executor.type).toBe('agent');
  });

  it('should run multi-turn subagent and return result', async () => {
    // Mock session factory, verify maxTurns and timeout respected
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd packages/agent-sdk && pnpm test -- --run src/hooks/__tests__/agent-executor.test.ts`
Expected: FAIL

- [ ] **Step 7: Implement AgentExecutor**

Takes a session factory via constructor (DI). Creates subagent session with `maxTurns` limit and `timeout`. Runs hook input as prompt. Parses `{ok, reason}` from final response.

- [ ] **Step 8: Run test to verify it passes**

Run: `cd packages/agent-sdk && pnpm test -- --run src/hooks/__tests__/agent-executor.test.ts`
Expected: PASS

- [ ] **Step 9: Create hooks/index.ts and wire into create-session**

Export both executors. In `create-session.ts`, register `[PromptExecutor, AgentExecutor]` as additional hook type executors passed to core's `runHooks`.

- [ ] **Step 10: Run all sdk tests**

Run: `cd packages/agent-sdk && pnpm test`
Expected: All PASS

- [ ] **Step 11: Commit**

```bash
git add packages/agent-sdk/src/hooks/ packages/agent-sdk/src/assembly/create-session.ts
git commit -m "feat(agent-sdk): add prompt and agent hook executors with DI wiring"
```

---

## Task 5: Multi-Path Skill Discovery & Frontmatter Upgrade (agent-cli)

**Files:**

- Modify: `packages/agent-cli/src/commands/skill-source.ts`
- Modify: `packages/agent-cli/src/commands/types.ts`
- Test: `packages/agent-cli/src/commands/__tests__/skill-source.test.ts`

- [ ] **Step 1: Write failing test for expanded scan paths**

```typescript
import { describe, it, expect } from 'vitest';
import { SkillCommandSource } from '../skill-source.js';

describe('SkillCommandSource multi-path', () => {
  it('should scan paths in priority order: .claude/skills > .claude/commands > ~/.claude/skills > .agents/skills', () => {
    // Verify scan order by checking getScanPaths() or similar
  });

  it('should parse full Claude Code frontmatter', () => {
    // Verify argument-hint, disable-model-invocation, user-invocable,
    // allowed-tools, model, effort, context, agent fields are parsed
  });

  it('should filter model-invocable skills', () => {
    // Skills with disable-model-invocation: true should be excluded from
    // getModelInvocableSkills()
  });

  it('should filter user-invocable skills', () => {
    // Skills with user-invocable: false should be excluded from
    // getUserInvocableSkills()
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-cli && pnpm build:deps && pnpm test -- --run src/commands/__tests__/skill-source.test.ts`
Expected: FAIL

- [ ] **Step 3: Extend ISlashCommand in types.ts**

Add Claude Code frontmatter fields:

```typescript
interface ISlashCommand {
  name: string;
  description: string;
  source: string;
  subcommands?: ISlashCommand[];
  execute?: (args: string) => void | Promise<void>;
  skillContent?: string;
  // Claude Code fields
  argumentHint?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[];
  model?: string;
  effort?: string;
  context?: string;
  agent?: string;
}
```

- [ ] **Step 4: Update SkillCommandSource**

- Add scan paths: `.claude/skills/`, `.claude/commands/`, `~/.claude/skills/` (before `.agents/skills/`)
- Upgrade frontmatter parser to extract all Claude Code fields
- Add `getModelInvocableSkills()` method (excludes `disableModelInvocation: true`)
- Add `getUserInvocableSkills()` method (excludes `userInvocable: false`)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/agent-cli && pnpm test -- --run src/commands/__tests__/skill-source.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agent-cli/src/commands/
git commit -m "feat(agent-cli): multi-path skill discovery with full Claude Code frontmatter"
```

---

## Task 6: Variable Substitution & Skill Execution (agent-cli)

**Files:**

- Modify: `packages/agent-cli/src/utils/skill-prompt.ts`
- Test: `packages/agent-cli/src/utils/__tests__/skill-prompt.test.ts`

- [ ] **Step 1: Write failing test for variable substitution**

```typescript
import { describe, it, expect } from 'vitest';
import { substituteVariables, buildSkillPrompt } from '../skill-prompt.js';

describe('Variable substitution', () => {
  it('should substitute $ARGUMENTS with all args', () => {
    const result = substituteVariables('Run $ARGUMENTS', 'file.ts --fix');
    expect(result).toBe('Run file.ts --fix');
  });

  it('should substitute $ARGUMENTS[0] with first arg', () => {
    const result = substituteVariables('Open $ARGUMENTS[0]', 'file.ts --fix');
    expect(result).toBe('Open file.ts');
  });

  it('should substitute $0 shorthand', () => {
    const result = substituteVariables('Open $0', 'file.ts');
    expect(result).toBe('Open file.ts');
  });

  it('should substitute ${CLAUDE_SESSION_ID}', () => {
    const result = substituteVariables('Session: ${CLAUDE_SESSION_ID}', '', { sessionId: 'abc' });
    expect(result).toBe('Session: abc');
  });

  it('should substitute ${CLAUDE_SKILL_DIR}', () => {
    const result = substituteVariables('Dir: ${CLAUDE_SKILL_DIR}', '', {
      skillDir: '/path/to/skill',
    });
    expect(result).toBe('Dir: /path/to/skill');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-cli && pnpm build:deps && pnpm test -- --run src/utils/__tests__/skill-prompt.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement substituteVariables and update buildSkillPrompt**

Add `substituteVariables(content, args, context?)` function. Update `buildSkillPrompt` to call it before returning skill content.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent-cli && pnpm test -- --run src/utils/__tests__/skill-prompt.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for shell command preprocessing**

```typescript
describe('Shell command preprocessing', () => {
  it('should execute !`command` and substitute output', async () => {
    const result = await preprocessShellCommands('Version: !`echo 1.0.0`');
    expect(result).toBe('Version: 1.0.0');
  });

  it('should handle multiple shell substitutions', async () => {
    const result = await preprocessShellCommands('!`echo a` and !`echo b`');
    expect(result).toBe('a and b');
  });

  it('should preserve content without shell commands', async () => {
    const result = await preprocessShellCommands('No commands here');
    expect(result).toBe('No commands here');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd packages/agent-cli && pnpm test -- --run src/utils/__tests__/skill-prompt.test.ts`
Expected: FAIL

- [ ] **Step 7: Implement preprocessShellCommands**

Add `preprocessShellCommands(content: string): Promise<string>` — regex matches `` !`...` `` patterns, spawns shell, captures stdout, replaces in content. Called by `buildSkillPrompt` before variable substitution.

- [ ] **Step 8: Run test to verify it passes**

Run: `cd packages/agent-cli && pnpm test -- --run src/utils/__tests__/skill-prompt.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/agent-cli/src/utils/skill-prompt.ts packages/agent-cli/src/utils/__tests__/skill-prompt.test.ts
git commit -m "feat(agent-cli): variable substitution and shell command preprocessing for skill prompts"
```

---

## Task 7: Skill Execution Features (agent-cli)

**Files:**

- Modify: `packages/agent-cli/src/commands/slash-executor.ts`
- Modify: `packages/agent-cli/src/utils/skill-prompt.ts`
- Test: `packages/agent-cli/src/commands/__tests__/skill-execution.test.ts`

- [ ] **Step 1: Write failing test for context: fork execution**

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Skill execution features', () => {
  it('should run skill in isolated subagent when context: fork', async () => {
    const skill = {
      name: 'test-skill',
      context: 'fork',
      agent: 'Explore',
      skillContent: 'Search for files',
    };
    // Verify subagent session is created with skill content as prompt
  });

  it('should scope allowed-tools in skill execution', async () => {
    const skill = {
      name: 'test-skill',
      allowedTools: ['Read', 'Grep'],
      skillContent: 'Read and search',
    };
    // Verify only Read and Grep are available during execution
  });

  it('should use specified agent type', async () => {
    const skill = {
      name: 'test-skill',
      context: 'fork',
      agent: 'Plan',
      skillContent: 'Create a plan',
    };
    // Verify agent type is passed to subagent factory
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-cli && pnpm build:deps && pnpm test -- --run src/commands/__tests__/skill-execution.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement skill execution features**

In slash-executor or a new `skill-executor.ts`:

- When `context: fork`, create isolated subagent session with skill content as prompt
- Pass `allowedTools` to session creation for permission scoping
- Use `agent` field to select subagent type
- Non-fork skills continue current behavior (content injected as user message)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent-cli && pnpm test -- --run src/commands/__tests__/skill-execution.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-cli/src/commands/ packages/agent-cli/src/utils/
git commit -m "feat(agent-cli): skill execution with context fork, allowed-tools, and agent type"
```

---

## Task 8: System Prompt Skill Injection (agent-sdk)

**Files:**

- Modify: `packages/agent-sdk/src/context/system-prompt-builder.ts`
- Test: `packages/agent-sdk/src/__tests__/system-prompt-builder.test.ts`

- [ ] **Step 1: Write failing test for skill list injection**

```typescript
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../system-prompt-builder.js';

describe('System prompt skill injection', () => {
  it('should include skill list in system prompt', () => {
    const result = buildSystemPrompt({
      // ...existing params
      skills: [
        { name: 'my-skill', description: 'Does useful things' },
        { name: 'hidden', description: 'Secret', disableModelInvocation: true },
      ],
    });

    expect(result).toContain('my-skill: Does useful things');
    expect(result).not.toContain('hidden');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-sdk && pnpm build:deps && pnpm test -- --run src/__tests__/system-prompt-builder.test.ts`
Expected: FAIL

- [ ] **Step 3: Add skills param to ISystemPromptParams and inject skill list**

Add `skills?: Array<{ name: string; description: string; disableModelInvocation?: boolean }>` to `ISystemPromptParams`. Filter out `disableModelInvocation: true`. Append skill list section to system prompt.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent-sdk && pnpm test -- --run src/__tests__/system-prompt-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-sdk/src/context/
git commit -m "feat(agent-sdk): inject discovered skill list into system prompt"
```

---

## Task 9: Wire Hooks into Execution Flow (agent-sdk)

**Files:**

- Modify: `packages/agent-sdk/src/assembly/create-session.ts`
- Test: `packages/agent-sdk/src/__tests__/hook-wiring.test.ts`

- [ ] **Step 1: Write failing test for hook wiring**

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Hook wiring in session', () => {
  it('should fire SessionStart hook on session creation', async () => {
    // Create session with hook config containing SessionStart hook
    // Verify hook command was executed
  });

  it('should fire PreToolUse hook before tool execution', async () => {
    // Verify hook fires and can block tool call (exit code 2)
  });

  it('should pass merged hook config from settings to core runner', async () => {
    // Verify DI: sdk loads config, passes to core's runHooks
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-sdk && pnpm build:deps && pnpm test -- --run src/__tests__/hook-wiring.test.ts`
Expected: FAIL

- [ ] **Step 3: Wire hooks in create-session.ts**

- Load hook config from merged settings
- Register sdk executors (prompt, agent) alongside core executors (command, http)
- Pass full executor array to `runHooks`
- Call `runHooks` at each wiring point (SessionStart, PreToolUse, PostToolUse, Stop, etc.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent-sdk && pnpm test -- --run src/__tests__/hook-wiring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-sdk/src/assembly/
git commit -m "feat(agent-sdk): wire hooks into session lifecycle and tool execution"
```

---

## Task 10: BundlePlugin Loader (agent-sdk)

**Files:**

- Create: `packages/agent-sdk/src/plugins/bundle-plugin-types.ts`
- Create: `packages/agent-sdk/src/plugins/bundle-plugin-loader.ts`
- Create: `packages/agent-sdk/src/plugins/index.ts`
- Test: `packages/agent-sdk/src/plugins/__tests__/bundle-plugin-loader.test.ts`

- [ ] **Step 1: Write failing test for BundlePlugin discovery and loading**

```typescript
import { describe, it, expect } from 'vitest';
import { BundlePluginLoader } from '../bundle-plugin-loader.js';

describe('BundlePluginLoader', () => {
  it('should discover plugins in ~/.claude/plugins/', async () => {
    // Mock filesystem with plugin directory structure
    // Verify plugin.json is read and validated
  });

  it('should load skills from plugin skills/ directory', async () => {
    // Verify skills are returned with namespace: skill-name@plugin-name
  });

  it('should load hooks from plugin hooks/hooks.json', async () => {
    // Verify hooks are merged into config
  });

  it('should skip disabled plugins', async () => {
    // enabledPlugins: { "my-plugin@marketplace": false }
    // Verify plugin is not loaded
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-sdk && pnpm build:deps && pnpm test -- --run src/plugins/__tests__/bundle-plugin-loader.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement bundle-plugin-types.ts**

```typescript
interface IBundlePluginManifest {
  name: string;
  version: string;
  description: string;
  features: {
    commands?: boolean;
    agents?: boolean;
    skills?: boolean;
    hooks?: boolean;
    mcp?: boolean;
  };
}

interface ILoadedBundlePlugin {
  manifest: IBundlePluginManifest;
  skills: ISlashCommand[];
  hooks: THooksConfig;
  mcpConfig?: unknown;
  agents: string[];
}
```

- [ ] **Step 4: Implement bundle-plugin-loader.ts**

- Scan `~/.claude/plugins/` for directories containing `.claude-plugin/plugin.json`
- Read and validate `plugin.json` manifest
- Load `skills/` subdirectory (reuse skill frontmatter parser)
- Load `hooks/hooks.json` if present
- Namespace skills as `skill-name@plugin-name`
- Filter by `enabledPlugins` from settings

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/agent-sdk && pnpm test -- --run src/plugins/__tests__/bundle-plugin-loader.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agent-sdk/src/plugins/
git commit -m "feat(agent-sdk): BundlePlugin loader with discovery, validation, and namespacing"
```

---

## Task 11: BundlePlugin Installer & Marketplace Client (agent-sdk)

**Files:**

- Create: `packages/agent-sdk/src/plugins/bundle-plugin-installer.ts`
- Create: `packages/agent-sdk/src/plugins/marketplace-client.ts`
- Test: `packages/agent-sdk/src/plugins/__tests__/marketplace-client.test.ts`
- Test: `packages/agent-sdk/src/plugins/__tests__/bundle-plugin-installer.test.ts`

- [ ] **Step 1: Write failing test for marketplace client**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { MarketplaceClient } from '../marketplace-client.js';

describe('MarketplaceClient', () => {
  it('should fetch manifest from GitHub repo', async () => {
    // Mock fetch for GitHub raw content
    // Verify marketplace.json is parsed
  });

  it('should list available plugins from manifest', async () => {
    // Verify plugin list with name, description, source
  });

  it('should support multiple marketplace sources', async () => {
    // Add two sources, verify both are queried
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-sdk && pnpm build:deps && pnpm test -- --run src/plugins/__tests__/marketplace-client.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement MarketplaceClient**

- Manage marketplace sources (add, list, remove)
- Fetch manifest from GitHub (raw content URL), Git URL, local path, or remote URL
- Parse `marketplace.json` format
- Return available plugin list

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent-sdk && pnpm test -- --run src/plugins/__tests__/marketplace-client.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for plugin installer**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { BundlePluginInstaller } from '../bundle-plugin-installer.js';

describe('BundlePluginInstaller', () => {
  it('should clone plugin from git source to ~/.claude/plugins/', async () => {
    // Mock git clone
    // Verify plugin directory created
  });

  it('should update enabledPlugins in settings', async () => {
    // Verify settings.json updated with plugin-name@marketplace: true
  });

  it('should uninstall by removing directory and settings entry', async () => {
    // Verify cleanup
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd packages/agent-sdk && pnpm test -- --run src/plugins/__tests__/bundle-plugin-installer.test.ts`
Expected: FAIL

- [ ] **Step 7: Implement BundlePluginInstaller**

- Install: clone/copy plugin to `~/.claude/plugins/<name>@<marketplace>/`
- Update `enabledPlugins` in appropriate settings file
- Uninstall: remove directory and settings entry
- Enable/disable: toggle `enabledPlugins` boolean

- [ ] **Step 8: Run test to verify it passes**

Run: `cd packages/agent-sdk && pnpm test -- --run src/plugins/__tests__/bundle-plugin-installer.test.ts`
Expected: PASS

- [ ] **Step 9: Register claude-plugins-official as default marketplace**

In `MarketplaceClient`, register `claude-plugins-official` (GitHub: `anthropics/claude-code`) as the built-in default marketplace source that is always available without user configuration.

- [ ] **Step 10: Update plugins/index.ts exports**

- [ ] **Step 11: Commit**

```bash
git add packages/agent-sdk/src/plugins/
git commit -m "feat(agent-sdk): marketplace client, BundlePlugin installer, default marketplace"
```

---

## Task 12: /plugin CLI Command (agent-cli)

**Files:**

- Modify: `packages/agent-cli/src/commands/builtin-source.ts`
- Modify: `packages/agent-cli/src/commands/slash-executor.ts`
- Create: `packages/agent-cli/src/commands/plugin-source.ts`
- Test: `packages/agent-cli/src/commands/__tests__/plugin-commands.test.ts`

- [ ] **Step 1: Write failing test for /plugin command**

```typescript
import { describe, it, expect } from 'vitest';

describe('/plugin command', () => {
  it('should list installed plugins', async () => {
    // /plugin → shows installed plugins
  });

  it('should install plugin from marketplace', async () => {
    // /plugin install name@marketplace
  });

  it('should enable/disable plugin', async () => {
    // /plugin enable name@marketplace
    // /plugin disable name@marketplace
  });

  it('should manage marketplace sources', async () => {
    // /plugin marketplace add <source>
    // /plugin marketplace list
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-cli && pnpm build:deps && pnpm test -- --run src/commands/__tests__/plugin-commands.test.ts`
Expected: FAIL

- [ ] **Step 3: Add /plugin to builtin-source.ts**

Add `plugin` command with subcommands: install, uninstall, enable, disable, marketplace (add, list, update).

- [ ] **Step 4: Implement plugin command handlers in slash-executor.ts**

- `/plugin` → list installed plugins
- `/plugin install <name>@<marketplace>` → call BundlePluginInstaller
- `/plugin uninstall <name>@<marketplace>` → call BundlePluginInstaller
- `/plugin enable/disable <name>@<marketplace>` → toggle enabledPlugins
- `/plugin marketplace add <source>` → call MarketplaceClient
- `/plugin marketplace list` → show configured marketplaces
- `/reload-plugins` → reload all plugin resources

- [ ] **Step 5: Create plugin-source.ts**

Discovers skills from loaded BundlePlugins and exposes them as an `ICommandSource`. Registered alongside `SkillCommandSource` in the command registry.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/agent-cli && pnpm test -- --run src/commands/__tests__/plugin-commands.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/agent-cli/src/commands/
git commit -m "feat(agent-cli): /plugin command with install, marketplace, and plugin skill discovery"
```

---

## Task 13: Integration Test & Build Verification

**Files:**

- Test: `packages/agent-core/src/hooks/__tests__/integration.test.ts`
- Test: `packages/agent-sdk/src/plugins/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration test for full hook flow**

Test end-to-end: config loaded → hook runner invoked with all 4 executor types → correct exit codes returned.

- [ ] **Step 2: Write integration test for BundlePlugin flow**

Test end-to-end: marketplace → install → load → skills discovered → hooks merged → system prompt includes skills.

- [ ] **Step 3: Run full build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 4: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core/src/hooks/__tests__/integration.test.ts packages/agent-sdk/src/plugins/__tests__/integration.test.ts
git commit -m "test: add integration tests for hook flow and BundlePlugin lifecycle"
```

---

## Task 14: Update SPEC.md Documentation

**Files:**

- Modify: `packages/agent-core/docs/SPEC.md`
- Modify: `packages/agent-sdk/docs/SPEC.md`
- Modify: `packages/agent-cli/docs/SPEC.md`

- [ ] **Step 1: Update agent-core SPEC.md**

Add: IHookTypeExecutor strategy interface, new hook events, discriminated union types, http executor.

- [ ] **Step 2: Update agent-sdk SPEC.md**

Add: BundlePlugin system, MarketplaceClient, prompt/agent hook executors, .claude/settings.json loading, system prompt skill injection.

- [ ] **Step 3: Update agent-cli SPEC.md**

Add: Multi-path skill discovery, Claude Code frontmatter schema, /plugin command, variable substitution, skill invocation methods.

- [ ] **Step 4: Commit**

```bash
git add packages/agent-core/docs/SPEC.md packages/agent-sdk/docs/SPEC.md packages/agent-cli/docs/SPEC.md
git commit -m "docs: update SPECs for Claude Code compatible extensions"
```
