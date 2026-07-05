import { describe, it, expect } from 'vitest';
import type { ICommand } from '@robota-sdk/agent-interface-transport';
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

function req(overrides?: Partial<ISkillResolveRequest>): ISkillResolveRequest {
  return { skillName: 'greet', args: 'World', cwd: '/tmp/x', ...overrides };
}

describe('SkillResolverRuntime', () => {
  it('resolves an inject skill to its expanded prompt (real executeSkill)', async () => {
    const runtime = new SkillResolverRuntime({ loadCommands: () => [greet, forkSkill] });
    const result = await runtime.resolvePrompt(req());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('inject');
      expect(result.value.prompt).toContain('skill name="greet"');
      expect(result.value.prompt).toContain('Say hello to World.');
    }
  });

  it('returns a not-found error listing available skills', async () => {
    const runtime = new SkillResolverRuntime({ loadCommands: () => [greet, forkSkill] });
    const result = await runtime.resolvePrompt(req({ skillName: 'missing' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_SKILL_NOT_FOUND');
      expect(result.error.fix?.options).toEqual(['greet', 'deep-research']);
    }
  });

  it('rejects a fork-context skill', async () => {
    const runtime = new SkillResolverRuntime({ loadCommands: () => [greet, forkSkill] });
    const result = await runtime.resolvePrompt(req({ skillName: 'deep-research' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_VALIDATION_SKILL_FORK_UNSUPPORTED');
  });

  it('surfaces a skill-discovery failure as a task error', async () => {
    const runtime = new SkillResolverRuntime({
      loadCommands: () => {
        throw new Error('disk gone');
      },
    });
    const result = await runtime.resolvePrompt(req());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_SKILL_RESOLVE_FAILED');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('surfaces an executeSkill failure as a task error', async () => {
    const runtime = new SkillResolverRuntime({
      loadCommands: () => [greet],
      executeSkillFn: async () => {
        throw new Error('boom');
      },
    });
    const result = await runtime.resolvePrompt(req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_TASK_EXECUTION_SKILL_RESOLVE_FAILED');
  });

  it('errors when executeSkill returns no inject prompt', async () => {
    const runtime = new SkillResolverRuntime({
      loadCommands: () => [greet],
      executeSkillFn: async () => ({ mode: 'fork', result: 'x' }),
    });
    const result = await runtime.resolvePrompt(req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_TASK_EXECUTION_SKILL_RESOLVE_FAILED');
  });

  it('substitutes positional args (0-based) and $ARGUMENTS', async () => {
    const runtime = new SkillResolverRuntime({
      loadCommands: () => [
        {
          name: 'echo',
          description: 'e',
          source: 'skill',
          skillContent: 'a=$0 b=$1 all=$ARGUMENTS',
        },
      ],
    });
    const result = await runtime.resolvePrompt(req({ skillName: 'echo', args: 'alpha beta' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prompt).toContain('a=alpha');
      expect(result.value.prompt).toContain('b=beta');
      expect(result.value.prompt).toContain('all=alpha beta');
    }
  });
});
