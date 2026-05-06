import { describe, expect, it, vi } from 'vitest';
import { createCommandExecutionTool } from '../command-execution-tool.js';

describe('command execution tool', () => {
  it('describes command execution without imperative prompt text', () => {
    const tool = createCommandExecutionTool({
      isModelInvocable: () => true,
      execute: vi.fn(),
    });

    expect(tool.schema.description).toContain('registered model-invocable Robota command');
    expect(tool.schema.description).toContain('command registry');
    expect(tool.schema.description).not.toContain('Use this');
    expect(tool.schema.description).not.toContain('assistant text');
    expect(tool.schema.description).not.toContain('pseudo-tags');
    expect(tool.schema.description).not.toContain('<agent');
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

  it('constrains command schema to registered model-invocable commands when provided', () => {
    const tool = createCommandExecutionTool({
      isModelInvocable: () => true,
      execute: vi.fn(),
      commandNames: ['skills', 'compact'],
    });

    const commandEnum = tool.schema.parameters.properties['command']?.enum;
    expect(commandEnum).toEqual(['skills', 'compact']);
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
