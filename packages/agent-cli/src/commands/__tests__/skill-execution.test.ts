import { describe, it, expect, vi } from 'vitest';
import {
  executeSkill,
  type ISkillExecutionCallbacks,
  type IForkExecutionOptions,
} from '../skill-executor.js';
import type { ISlashCommand } from '../types.js';

function makeSkill(overrides?: Partial<ISlashCommand>): ISlashCommand {
  return {
    name: 'test-skill',
    description: 'A test skill',
    source: 'skill',
    skillContent: '# Test Skill\nDo the thing with $ARGUMENTS',
    ...overrides,
  };
}

function mockRunInFork(
  returnValue = 'ok',
): [
  (content: string, options: IForkExecutionOptions) => Promise<string>,
  { calls: Array<[string, IForkExecutionOptions]> },
] {
  const tracker = { calls: [] as Array<[string, IForkExecutionOptions]> };
  const fn = async (content: string, options: IForkExecutionOptions): Promise<string> => {
    tracker.calls.push([content, options]);
    return returnValue;
  };
  return [fn, tracker];
}

describe('Skill execution features', () => {
  describe('executeSkill', () => {
    it('should run skill in isolated subagent when context: fork', async () => {
      const [runInFork, tracker] = mockRunInFork('fork result');
      const callbacks: ISkillExecutionCallbacks = { runInFork };
      const skill = makeSkill({ context: 'fork' });

      const result = await executeSkill(skill, 'my-args', callbacks);

      expect(result.mode).toBe('fork');
      expect(result.result).toBe('fork result');
      expect(tracker.calls).toHaveLength(1);
      expect(tracker.calls[0]![0]).toContain('Do the thing with my-args');
    });

    it('should scope allowed-tools in fork execution', async () => {
      const [runInFork, tracker] = mockRunInFork();
      const callbacks: ISkillExecutionCallbacks = { runInFork };
      const skill = makeSkill({
        context: 'fork',
        allowedTools: ['Read', 'Grep'],
      });

      await executeSkill(skill, '', callbacks);

      expect(tracker.calls[0]![1]).toEqual(
        expect.objectContaining({ allowedTools: ['Read', 'Grep'] }),
      );
    });

    it('should use specified agent type in fork execution', async () => {
      const [runInFork, tracker] = mockRunInFork();
      const callbacks: ISkillExecutionCallbacks = { runInFork };
      const skill = makeSkill({
        context: 'fork',
        agent: 'Explore',
      });

      await executeSkill(skill, '', callbacks);

      expect(tracker.calls[0]![1]).toEqual(expect.objectContaining({ agent: 'Explore' }));
    });

    it('should inject as user message when no context: fork', async () => {
      const callbacks: ISkillExecutionCallbacks = {};
      const skill = makeSkill(); // no context set

      const result = await executeSkill(skill, 'some args', callbacks);

      expect(result.mode).toBe('inject');
      expect(result.prompt).toContain('Do the thing with some args');
      expect(result.result).toBeUndefined();
    });

    it('should return inject mode for non-fork context values', async () => {
      const callbacks: ISkillExecutionCallbacks = {};
      const skill = makeSkill({ context: 'project' });

      const result = await executeSkill(skill, '', callbacks);

      expect(result.mode).toBe('inject');
      expect(result.prompt).toBeDefined();
    });

    it('should fall back to inject when context: fork but no runInFork callback', async () => {
      const callbacks: ISkillExecutionCallbacks = {};
      const skill = makeSkill({ context: 'fork' });

      const result = await executeSkill(skill, 'args', callbacks);

      expect(result.mode).toBe('inject');
      expect(result.prompt).toContain('Do the thing with args');
    });

    it('should handle skill without skillContent', async () => {
      const callbacks: ISkillExecutionCallbacks = {};
      const skill = makeSkill({ skillContent: undefined });

      const result = await executeSkill(skill, 'args', callbacks);

      expect(result.mode).toBe('inject');
      expect(result.prompt).toContain('Use the "test-skill" skill');
    });

    it('should pass both agent and allowedTools together', async () => {
      const [runInFork, tracker] = mockRunInFork('done');
      const callbacks: ISkillExecutionCallbacks = { runInFork };
      const skill = makeSkill({
        context: 'fork',
        agent: 'Plan',
        allowedTools: ['Bash', 'Read', 'Grep'],
      });

      await executeSkill(skill, '', callbacks);

      expect(tracker.calls[0]![1]).toEqual({
        agent: 'Plan',
        allowedTools: ['Bash', 'Read', 'Grep'],
      });
    });

    it('should substitute variables in fork content', async () => {
      const [runInFork, tracker] = mockRunInFork('result');
      const callbacks: ISkillExecutionCallbacks = { runInFork };
      const skill = makeSkill({
        context: 'fork',
        skillContent: 'Review $ARGUMENTS[0] with focus on $ARGUMENTS[1]',
      });

      await executeSkill(skill, 'file.ts security', callbacks);

      expect(tracker.calls[0]![0]).toContain('Review file.ts with focus on security');
    });

    it('should accept optional context for variable substitution', async () => {
      const callbacks: ISkillExecutionCallbacks = {};
      const skill = makeSkill({
        skillContent: 'Session: ${CLAUDE_SESSION_ID}',
      });

      const result = await executeSkill(skill, '', callbacks, {
        sessionId: 'sess-abc',
      });

      expect(result.prompt).toContain('Session: sess-abc');
    });
  });
});
