import { describe, expect, it, vi } from 'vitest';

import { scriptedSession } from '@robota-sdk/agent-framework/testing';

import { createKeybindingsCommandModule } from '../keybindings-command-module.js';

import type { ITerminalHandoff } from '@robota-sdk/agent-interface-session';

function handoff(enabled: boolean): ITerminalHandoff {
  return {
    canHandoffTerminal: enabled,
    runWithTerminal: async (operation) => operation(),
  };
}

describe('/keybindings command', () => {
  it('ensures and opens the exact capability-owned path', async () => {
    const ensureFile = vi.fn().mockResolvedValue('/tmp/keybindings.json');
    const previous = process.env.EDITOR;
    process.env.EDITOR = 'true';
    const session = scriptedSession({
      turns: [{ text: 'unused' }],
      terminalHandoff: handoff(true),
      commandModules: [createKeybindingsCommandModule({ ensureFile })],
    });
    try {
      const result = await session.command('keybindings', '');
      expect(result).toMatchObject({
        success: true,
        message: 'Opened keybindings: /tmp/keybindings.json',
        data: { path: '/tmp/keybindings.json' },
      });
      expect(ensureFile).toHaveBeenCalledTimes(1);
    } finally {
      await session.dispose();
      if (previous === undefined) delete process.env.EDITOR;
      else process.env.EDITOR = previous;
    }
  });

  it('reports an unavailable terminal without creating a file', async () => {
    const ensureFile = vi.fn().mockResolvedValue('/tmp/keybindings.json');
    const session = scriptedSession({
      turns: [{ text: 'unused' }],
      terminalHandoff: handoff(false),
      commandModules: [createKeybindingsCommandModule({ ensureFile })],
    });
    try {
      const result = await session.command('keybindings', '');
      expect(result?.success).toBe(false);
      expect(result?.message).toMatch(/unavailable/i);
      expect(ensureFile).not.toHaveBeenCalled();
    } finally {
      await session.dispose();
    }
  });
});
