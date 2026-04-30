import { describe, expect, it, vi } from 'vitest';
import { createCommandExecutionTool } from '../command-execution-tool.js';

describe('command execution tool', () => {
  it('describes tool execution as the required path instead of assistant text', () => {
    const tool = createCommandExecutionTool({
      isModelInvocable: () => true,
      execute: vi.fn(),
    });

    expect(tool.schema.description).toContain('Use this tool when command execution is required');
    expect(tool.schema.description).toContain('pseudo-tags');
    expect(tool.schema.description).toContain('JSON arguments');
    expect(tool.schema.description).toContain('"command":"agent"');
  });

  it('executes only model-invocable commands through the injected command handler', async () => {
    const execute = vi.fn().mockResolvedValue({
      message: 'Started agent_1',
      success: true,
      data: { agentId: 'agent_1' },
    });
    const tool = createCommandExecutionTool({
      isModelInvocable: (command) => command === 'agent',
      execute,
    });

    const result = await tool.execute({
      command: '/agent',
      args: 'run Plan --background "draft architecture"',
    });

    expect(execute).toHaveBeenCalledWith('agent', 'run Plan --background "draft architecture"');
    expect(String(result.data)).toContain('"agentId":"agent_1"');
  });

  it('rejects commands that are not model invocable', async () => {
    const execute = vi.fn();
    const tool = createCommandExecutionTool({
      isModelInvocable: () => false,
      execute,
    });

    const result = await tool.execute({
      command: '/reset',
      args: '',
    });

    expect(execute).not.toHaveBeenCalled();
    expect(String(result.data)).toContain('not model-invocable');
  });
});
