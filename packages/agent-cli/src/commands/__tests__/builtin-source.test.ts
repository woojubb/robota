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
    expect(names).toContain('model');
    expect(names).toContain('compact');
    expect(names).toContain('cost');
    expect(names).toContain('context');
    expect(names).toContain('permissions');
    expect(names).toContain('exit');
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

  describe('/model subcommands', () => {
    const modelCmd = commands.find((c) => c.name === 'model');
    const subcommands = modelCmd?.subcommands ?? [];

    it('has subcommands', () => {
      expect(subcommands.length).toBeGreaterThan(0);
    });

    it('subcommands have model IDs as names', () => {
      const names = subcommands.map((s) => s.name);
      expect(names).toContain('claude-opus-4-6');
      expect(names).toContain('claude-sonnet-4-6');
      expect(names).toContain('claude-haiku-4-5');
    });

    it('descriptions show human-readable name with context window', () => {
      const opus = subcommands.find((s) => s.name === 'claude-opus-4-6');
      expect(opus?.description).toBe('Claude Opus 4.6 (1M)');

      const haiku = subcommands.find((s) => s.name === 'claude-haiku-4-5');
      expect(haiku?.description).toBe('Claude Haiku 4.5 (200K)');
    });

    it('deduplicates date-suffixed model variants', () => {
      const names = subcommands.map((s) => s.name);
      // date-suffixed variants should not appear
      expect(names).not.toContain('claude-haiku-4-5-20251001');
      expect(names).not.toContain('claude-sonnet-4-5-20250929');
      expect(names).not.toContain('claude-opus-4-5-20251101');
    });

    it('uses uppercase K/M in context window formatting', () => {
      for (const sub of subcommands) {
        // Each description should contain (xxxK) or (xM), not lowercase
        const match = sub.description.match(/\((\d+[KM])\)/);
        expect(match).not.toBeNull();
      }
    });
  });
});
