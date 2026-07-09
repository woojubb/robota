import { describe, it, expect, vi } from 'vitest';
import type {
  ICommand,
  ISkillExecutionPort,
  ISkillResolutionResult,
} from '@robota-sdk/agent-interface-transport';
import { SkillResolverRuntime, type ISkillResolveRequest } from './runtime-core.js';

const greet: ICommand = {
  name: 'greet',
  description: 'Greets the user',
  source: 'skill',
  skillContent: 'Say hello to $ARGUMENTS.',
};

const forkSkill: ICommand = {
  name: 'deep-research',
  description: 'Runs deep research',
  source: 'skill',
  context: 'fork',
  skillContent: 'Research $ARGUMENTS thoroughly.',
};

/**
 * Stub {@link ISkillExecutionPort} — the runtime is a leaf that depends on the port contract, so its tests
 * inject a stub (no agent-framework, no real executeSkill). The REAL inject-prompt shape (XML wrap +
 * `$ARGUMENTS` substitution + empty-shell strip) is covered by the agent-framework adapter test (TC-02).
 */
function stubPort(overrides?: Partial<ISkillExecutionPort>): ISkillExecutionPort {
  return {
    loadCommands: () => [greet, forkSkill],
    resolveSkill: async (skill, args): Promise<ISkillResolutionResult> => ({
      mode: 'inject',
      prompt: `<skill name="${skill.name}">resolved ${args}</skill>`,
    }),
    ...overrides,
  };
}

function req(overrides?: Partial<ISkillResolveRequest>): ISkillResolveRequest {
  return { skillName: 'greet', args: 'World', cwd: '/tmp/x', ...overrides };
}

describe('SkillResolverRuntime (ARCH-PROVIDER-005 — port-injected)', () => {
  it('routes discovery + resolution through the injected port and returns its result', async () => {
    const resolveSkill = vi.fn(async () => ({ mode: 'inject', prompt: 'PROMPT-FROM-PORT' }));
    const runtime = new SkillResolverRuntime({ skillPort: stubPort({ resolveSkill }) });
    const result = await runtime.resolvePrompt(req());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('inject');
      expect(result.value.prompt).toBe('PROMPT-FROM-PORT');
    }
    // The port's resolveSkill is called with the discovered skill + args (callbacks hidden by the port).
    expect(resolveSkill).toHaveBeenCalledWith(greet, 'World', undefined);
  });

  it('forwards the sessionId to the port when provided', async () => {
    const resolveSkill = vi.fn(async () => ({ mode: 'inject', prompt: 'p' }));
    const runtime = new SkillResolverRuntime({ skillPort: stubPort({ resolveSkill }) });
    await runtime.resolvePrompt(req({ sessionId: 'sess-1' }));
    expect(resolveSkill).toHaveBeenCalledWith(greet, 'World', { sessionId: 'sess-1' });
  });

  it('returns a not-found error listing available skills', async () => {
    const runtime = new SkillResolverRuntime({ skillPort: stubPort() });
    const result = await runtime.resolvePrompt(req({ skillName: 'missing' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_SKILL_NOT_FOUND');
      expect(result.error.fix?.options).toEqual(['greet', 'deep-research']);
    }
  });

  it('rejects a fork-context skill BEFORE calling the port', async () => {
    const resolveSkill = vi.fn(async () => ({ mode: 'inject', prompt: 'p' }));
    const runtime = new SkillResolverRuntime({ skillPort: stubPort({ resolveSkill }) });
    const result = await runtime.resolvePrompt(req({ skillName: 'deep-research' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_VALIDATION_SKILL_FORK_UNSUPPORTED');
    expect(resolveSkill).not.toHaveBeenCalled();
  });

  it('surfaces a discovery failure (port.loadCommands throws) as a retryable task error', async () => {
    const runtime = new SkillResolverRuntime({
      skillPort: stubPort({
        loadCommands: () => {
          throw new Error('disk gone');
        },
      }),
    });
    const result = await runtime.resolvePrompt(req());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_SKILL_RESOLVE_FAILED');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('surfaces a resolution failure (port.resolveSkill throws) as a task error', async () => {
    const runtime = new SkillResolverRuntime({
      skillPort: stubPort({
        resolveSkill: async () => {
          throw new Error('boom');
        },
      }),
    });
    const result = await runtime.resolvePrompt(req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_TASK_EXECUTION_SKILL_RESOLVE_FAILED');
  });

  it('errors when the port returns no inject prompt', async () => {
    const runtime = new SkillResolverRuntime({
      skillPort: stubPort({ resolveSkill: async () => ({ mode: 'fork' }) }),
    });
    const result = await runtime.resolvePrompt(req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_TASK_EXECUTION_SKILL_RESOLVE_FAILED');
  });
});
