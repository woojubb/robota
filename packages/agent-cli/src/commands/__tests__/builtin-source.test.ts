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
    expect(names).not.toContain('memory');
    expect(names).not.toContain('cost');
    expect(names).not.toContain('clear');
    expect(names).not.toContain('rename');
    expect(names).not.toContain('resume');
    expect(names).not.toContain('permissions');
    expect(names).not.toContain('compact');
    expect(names).not.toContain('context');
    expect(names).not.toContain('language');
    expect(names).not.toContain('model');
    expect(names).not.toContain('mode');
    expect(names).not.toContain('provider');
    expect(names).not.toContain('reset');
    expect(names).not.toContain('rewind');
    expect(names).not.toContain('background');
    expect(names).not.toContain('statusline');
    expect(names).not.toContain('plugin');
    expect(names).not.toContain('exit');
  });

  it('all commands have source "builtin"', () => {
    for (const cmd of commands) {
      expect(cmd.source).toBe('builtin');
    }
  });
});
