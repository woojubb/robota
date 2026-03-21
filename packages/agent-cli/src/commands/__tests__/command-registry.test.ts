import { describe, it, expect } from 'vitest';
import { CommandRegistry } from '../command-registry.js';
import type { ICommandSource, ISlashCommand } from '../types.js';

function createMockSource(name: string, commands: ISlashCommand[]): ICommandSource {
  return { name, getCommands: () => commands };
}

describe('CommandRegistry', () => {
  it('returns empty list with no sources', () => {
    const registry = new CommandRegistry();
    expect(registry.getCommands()).toEqual([]);
  });

  it('aggregates commands from multiple sources', () => {
    const registry = new CommandRegistry();
    registry.addSource(
      createMockSource('a', [{ name: 'help', description: 'Help', source: 'a' }]),
    );
    registry.addSource(
      createMockSource('b', [{ name: 'deploy', description: 'Deploy', source: 'b' }]),
    );
    const all = registry.getCommands();
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.name)).toEqual(['help', 'deploy']);
  });

  it('filters commands by prefix', () => {
    const registry = new CommandRegistry();
    registry.addSource(
      createMockSource('test', [
        { name: 'mode', description: 'Mode', source: 'test' },
        { name: 'model', description: 'Model', source: 'test' },
        { name: 'help', description: 'Help', source: 'test' },
      ]),
    );
    const filtered = registry.getCommands('mod');
    expect(filtered.map((c) => c.name)).toEqual(['mode', 'model']);
  });

  it('filter is case-insensitive', () => {
    const registry = new CommandRegistry();
    registry.addSource(
      createMockSource('test', [
        { name: 'Help', description: 'Help', source: 'test' },
      ]),
    );
    expect(registry.getCommands('help')).toHaveLength(1);
    expect(registry.getCommands('HELP')).toHaveLength(1);
  });

  describe('getSubcommands', () => {
    it('returns subcommands for a command with subcommands', () => {
      const registry = new CommandRegistry();
      registry.addSource(
        createMockSource('test', [
          {
            name: 'model',
            description: 'Model',
            source: 'test',
            subcommands: [
              { name: 'claude-opus-4-6', description: 'Claude Opus 4.6 (1M)', source: 'test' },
              { name: 'claude-sonnet-4-6', description: 'Claude Sonnet 4.6 (1M)', source: 'test' },
            ],
          },
        ]),
      );
      const subs = registry.getSubcommands('model');
      expect(subs).toHaveLength(2);
      expect(subs[0].name).toBe('claude-opus-4-6');
    });

    it('returns empty array for command without subcommands', () => {
      const registry = new CommandRegistry();
      registry.addSource(
        createMockSource('test', [
          { name: 'help', description: 'Help', source: 'test' },
        ]),
      );
      expect(registry.getSubcommands('help')).toEqual([]);
    });

    it('returns empty array for unknown command', () => {
      const registry = new CommandRegistry();
      expect(registry.getSubcommands('nonexistent')).toEqual([]);
    });

    it('lookup is case-insensitive', () => {
      const registry = new CommandRegistry();
      registry.addSource(
        createMockSource('test', [
          {
            name: 'Mode',
            description: 'Mode',
            source: 'test',
            subcommands: [
              { name: 'plan', description: 'Plan', source: 'test' },
            ],
          },
        ]),
      );
      expect(registry.getSubcommands('mode')).toHaveLength(1);
      expect(registry.getSubcommands('MODE')).toHaveLength(1);
    });
  });
});
