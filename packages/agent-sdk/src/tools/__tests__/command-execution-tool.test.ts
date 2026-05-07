import { describe, expect, it, vi } from 'vitest';
import { createCommandExecutionTool } from '../command-execution-tool.js';
import {
  createModelCommandToolProjection,
  createProjectedCommandExecutionTools,
  createProviderSafeModelCommandToolName,
  MODEL_COMMAND_TOOL_PREFIX,
  PROVIDER_SAFE_TOOL_NAME_PATTERN,
} from '../model-command-tool-projection.js';

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

describe('model command tool projection', () => {
  it('projects model command descriptors into provider-safe command tool names', () => {
    const projection = createModelCommandToolProjection([
      {
        name: 'skills',
        description: 'Skill discovery command.',
        argumentHint: '[list | <skill-name> [args]]',
      },
      {
        name: 'agent',
        description: 'Background agent command.',
      },
    ]);

    expect(projection.commandNameToToolName.get('skills')).toBe('robota_command_skills');
    expect(projection.toolNameToCommandName.get('robota_command_agent')).toBe('agent');
    expect(projection.commandTools.map((tool) => tool.toolName)).toEqual([
      'robota_command_skills',
      'robota_command_agent',
    ]);
    expect(projection.commandTools[0]?.description).toContain('Skill discovery command.');
    expect(projection.commandTools[0]?.description).toContain(
      'Argument grammar: [list | <skill-name> [args]]',
    );
  });

  it('keeps projected tool names within provider naming constraints', () => {
    const toolName = createProviderSafeModelCommandToolName(
      'command.with.symbols.and.a.very.long.name.that.exceeds.the.provider.tool.name.limit',
    );

    expect(toolName.startsWith(MODEL_COMMAND_TOOL_PREFIX)).toBe(true);
    expect(toolName.length).toBeLessThanOrEqual(64);
    expect(PROVIDER_SAFE_TOOL_NAME_PATTERN.test(toolName)).toBe(true);
  });

  it('rejects duplicate command descriptors before registering tools', () => {
    expect(() =>
      createModelCommandToolProjection([
        { name: 'skills', description: 'First skills command.' },
        { name: '/skills', description: 'Duplicate skills command.' },
      ]),
    ).toThrow('Duplicate model command descriptor: skills');
  });

  it('executes projected command tools through the injected command handler', async () => {
    const execute = vi.fn().mockResolvedValue({
      message: 'Skill loaded',
      success: true,
      data: { skill: 'repo-writing' },
    });
    const [tool] = createProjectedCommandExecutionTools({
      isModelInvocable: (command) => command === 'skills',
      execute,
      commandDescriptors: [
        {
          name: 'skills',
          description: 'Skill discovery command.',
          argumentHint: '[list | <skill-name> [args]]',
        },
      ],
    });

    expect(tool?.getName()).toBe('robota_command_skills');
    expect(tool?.schema.parameters.properties['args']?.description).toContain(
      '[list | <skill-name> [args]]',
    );

    const result = await tool!.execute({ args: 'repo-writing update docs' });

    expect(execute).toHaveBeenCalledWith('skills', 'repo-writing update docs');
    expect(String(result.data)).toContain('"success":true');
    expect(String(result.data)).toContain('"skill":"repo-writing"');
  });

  it('does not execute projected command tools when the command is no longer model-invocable', async () => {
    const execute = vi.fn();
    const [tool] = createProjectedCommandExecutionTools({
      isModelInvocable: () => false,
      execute,
      commandDescriptors: [
        {
          name: 'compact',
          description: 'Context compaction command.',
        },
      ],
    });

    const result = await tool!.execute({});

    expect(execute).not.toHaveBeenCalled();
    expect(String(result.data)).toContain('not model-invocable');
  });
});
