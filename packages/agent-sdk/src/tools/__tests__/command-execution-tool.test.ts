import { describe, expect, it, vi } from 'vitest';
import { createCommandExecutionTool } from '../command-execution-tool.js';

describe('command execution tool', () => {
  it('describes command execution without command-specific prompt text when no descriptors are provided', () => {
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

  it('includes registered command descriptor guidance in the tool description', () => {
    const tool = createCommandExecutionTool({
      isModelInvocable: () => true,
      execute: vi.fn(),
      commandDescriptors: [
        {
          name: 'compact',
          description:
            'Context compaction command. Call it when the user explicitly requests compaction.',
          argumentHint: '[filter]',
        },
      ],
    });

    expect(tool.schema.description).toContain('Registered model-invocable commands:');
    expect(tool.schema.description).toContain('compact [filter]:');
    expect(tool.schema.description).toContain('explicitly requests compaction');
    expect(tool.schema.description).not.toContain('<agent');
    expect(tool.schema.description).not.toContain('/compact');
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
      commandNames: ['agent'],
    });

    const result = await tool.execute({
      command: 'agent',
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

  it('derives normalized command enum values from command descriptors', () => {
    const tool = createCommandExecutionTool({
      isModelInvocable: () => true,
      execute: vi.fn(),
      commandDescriptors: [
        { name: 'memory', description: 'Project memory command' },
        { name: 'compact', description: 'Compact context' },
      ],
    });

    const commandEnum = tool.schema.parameters.properties['command']?.enum;
    expect(commandEnum).toEqual(['memory', 'compact']);
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
