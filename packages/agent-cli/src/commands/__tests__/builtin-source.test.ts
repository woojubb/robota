import { describe, it, expect } from 'vitest';
import { BuiltinCommandSource } from '../builtin-source.js';

describe('BuiltinCommandSource', () => {
  const source = new BuiltinCommandSource();
  const commands = source.getCommands();

  it('has name "builtin"', () => {
    expect(source.name).toBe('builtin');
  });

  it('returns expected built-in commands', () => {
    const names = commands.map((c) => c.name);
    expect(names).toContain('help');
    expect(names).toContain('clear');
    expect(names).toContain('mode');
    expect(names).toContain('cost');
    expect(names).toContain('permissions');
    expect(names).not.toContain('compact');
    expect(names).not.toContain('context');
    expect(names).not.toContain('model');
    expect(names).not.toContain('provider');
    expect(names).not.toContain('plugin');
    expect(names).not.toContain('exit');
  });

  it('all commands have source "builtin"', () => {
    for (const cmd of commands) {
      expect(cmd.source).toBe('builtin');
    }
  });

  describe('/mode subcommands', () => {
    const modeCmd = commands.find((c) => c.name === 'mode');

    it('has subcommands', () => {
      expect(modeCmd?.subcommands).toBeDefined();
      expect(modeCmd!.subcommands!.length).toBeGreaterThan(0);
    });

    it('contains all 4 permission modes', () => {
      const names = modeCmd!.subcommands!.map((s) => s.name);
      expect(names).toEqual(['plan', 'default', 'acceptEdits', 'bypassPermissions']);
    });
  });
});
