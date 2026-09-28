import { describe, expect, it } from 'vitest';

import { excludedCommandMessage, isExcludedCommand } from '../excluded-commands.js';

describe('isExcludedCommand (#3282 §4e)', () => {
  it('excludes every named command on the exclusion list', () => {
    for (const name of ['theme', 'keybindings', 'editor', 'statusline', 'shell', 'exit', 'devices']) {
      expect(isExcludedCommand({ name })).toBe(true);
    }
  });

  it('excludes a client-only command not restricted to the gui surface, named or not', () => {
    expect(isExcludedCommand({ name: 'shell', runner: 'client', surfaces: ['terminal'] })).toBe(true);
    expect(isExcludedCommand({ name: 'some-future-command', runner: 'client', surfaces: ['terminal'] })).toBe(
      true,
    );
  });

  it('does not exclude a client-only command that DOES run on the gui surface', () => {
    expect(isExcludedCommand({ name: 'some-future-command', runner: 'client', surfaces: ['gui'] })).toBe(
      false,
    );
  });

  it('does not exclude an ordinary session-run command', () => {
    for (const name of ['help', 'mode', 'git', 'memory', 'settings', 'agent', 'plugin']) {
      expect(isExcludedCommand({ name, runner: 'runtime' })).toBe(false);
    }
  });
});

describe('excludedCommandMessage (#3282 §4e)', () => {
  it('gives every named exclusion its own plain sentence, never the raw command name alone', () => {
    const names = ['theme', 'keybindings', 'editor', 'statusline', 'shell', 'exit', 'devices'];
    const messages = names.map(excludedCommandMessage);
    expect(new Set(messages).size).toBe(names.length); // every reason is distinct
    for (const message of messages) {
      expect(message).not.toMatch(/not available on this surface/);
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it('falls back to an honest generic sentence for an uncurated client-only command', () => {
    expect(excludedCommandMessage('some-future-command')).toBe('This command runs in the robota terminal.');
  });
});
