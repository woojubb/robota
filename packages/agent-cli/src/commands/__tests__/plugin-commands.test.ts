import { describe, it, expect } from 'vitest';
import { PluginCommandSource } from '../plugin-source.js';
import type { ILoadedBundlePlugin } from '@robota-sdk/agent-sdk';

describe('PluginCommandSource', () => {
  function createMockPlugin(
    name: string,
    skills: Array<{ name: string; description: string; skillContent: string }>,
    commands: Array<{ name: string; description: string; skillContent: string }> = [],
  ): ILoadedBundlePlugin {
    return {
      manifest: {
        name,
        version: '1.0.0',
        description: `Plugin ${name}`,
        features: { skills: true },
      },
      skills,
      commands,
      hooks: {},
      agents: [],
      pluginDir: `/plugins/${name}`,
    };
  }

  it('should expose plugin skills with base name and (plugin) hint in description', () => {
    const plugin = createMockPlugin('my-plugin', [
      { name: 'deploy', description: 'Deploy app', skillContent: '# Deploy' },
      { name: 'test', description: 'Run tests', skillContent: '# Test' },
    ]);

    const source = new PluginCommandSource([plugin]);
    const commands = source.getCommands();

    expect(commands).toHaveLength(2);
    expect(commands[0]!.name).toBe('deploy');
    expect(commands[0]!.description).toBe('(my-plugin) Deploy app');
    expect(commands[0]!.source).toBe('plugin');
    expect(commands[0]!.skillContent).toBe('# Deploy');
    expect(commands[1]!.name).toBe('test');
    expect(commands[1]!.description).toBe('(my-plugin) Run tests');
  });

  it('should strip @plugin suffix from legacy skill names', () => {
    const plugin = createMockPlugin('my-plugin', [
      { name: 'deploy@my-plugin', description: 'Deploy app', skillContent: '# Deploy' },
    ]);

    const source = new PluginCommandSource([plugin]);
    const commands = source.getCommands();

    expect(commands[0]!.name).toBe('deploy');
  });

  it('should expose commands with plugin:name format', () => {
    const plugin = createMockPlugin(
      'my-plugin',
      [],
      [
        { name: 'my-plugin:init', description: 'Initialize', skillContent: '# Init' },
        { name: 'my-plugin:audit', description: 'Run audit', skillContent: '# Audit' },
      ],
    );

    const source = new PluginCommandSource([plugin]);
    const commands = source.getCommands();

    expect(commands).toHaveLength(2);
    expect(commands[0]!.name).toBe('my-plugin:init');
    expect(commands[0]!.description).toBe('Initialize');
    expect(commands[1]!.name).toBe('my-plugin:audit');
  });

  it('should handle multiple plugins with skills and commands', () => {
    const plugin1 = createMockPlugin(
      'plugin-a',
      [{ name: 'skill-1', description: 'Skill 1', skillContent: '# S1' }],
      [{ name: 'plugin-a:cmd-1', description: 'Cmd 1', skillContent: '# C1' }],
    );
    const plugin2 = createMockPlugin('plugin-b', [
      { name: 'skill-2', description: 'Skill 2', skillContent: '# S2' },
    ]);

    const source = new PluginCommandSource([plugin1, plugin2]);
    const commands = source.getCommands();

    expect(commands).toHaveLength(3);
    expect(commands[0]!.name).toBe('skill-1');
    expect(commands[0]!.description).toBe('(plugin-a) Skill 1');
    expect(commands[1]!.name).toBe('plugin-a:cmd-1');
    expect(commands[2]!.name).toBe('skill-2');
    expect(commands[2]!.description).toBe('(plugin-b) Skill 2');
  });

  it('should return empty array when no plugins', () => {
    const source = new PluginCommandSource([]);
    expect(source.getCommands()).toEqual([]);
  });

  it('should return empty array when plugins have no skills or commands', () => {
    const plugin = createMockPlugin('empty-plugin', [], []);
    const source = new PluginCommandSource([plugin]);
    expect(source.getCommands()).toEqual([]);
  });

  it('should have name "plugin"', () => {
    const source = new PluginCommandSource([]);
    expect(source.name).toBe('plugin');
  });
});
