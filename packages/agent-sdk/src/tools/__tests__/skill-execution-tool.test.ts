import { describe, expect, it, vi } from 'vitest';
import { createSkillExecutionTool } from '../skill-execution-tool.js';

describe('skill execution tool', () => {
  it('describes skill activation as a runtime tool contract', () => {
    const tool = createSkillExecutionTool({
      isModelInvocable: () => true,
      execute: vi.fn(),
    });

    expect(tool.schema.name).toBe('ExecuteSkill');
    expect(tool.schema.description).toContain('registered model-invocable Robota skill');
    expect(tool.schema.description).toContain('plain text references do not activate skills');
  });

  it('executes only model-invocable skills through the injected skill handler', async () => {
    const execute = vi.fn().mockResolvedValue({
      mode: 'inject',
      prompt: '<skill name="audit">Audit src/index.ts</skill>',
    });
    const tool = createSkillExecutionTool({
      isModelInvocable: (skill) => skill === 'audit',
      execute,
    });

    const result = await tool.execute({
      skill: '/audit',
      args: 'src/index.ts',
    });

    expect(execute).toHaveBeenCalledWith('audit', 'src/index.ts');
    expect(String(result.data)).toContain('"success":true');
    expect(String(result.data)).toContain('"mode":"inject"');
    expect(String(result.data)).toContain('Audit src/index.ts');
  });

  it('rejects skills that are not model invocable', async () => {
    const execute = vi.fn();
    const tool = createSkillExecutionTool({
      isModelInvocable: () => false,
      execute,
    });

    const result = await tool.execute({
      skill: '/internal-only',
      args: '',
    });

    expect(execute).not.toHaveBeenCalled();
    expect(String(result.data)).toContain('not model-invocable');
  });
});
