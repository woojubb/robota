import { describe, expect, it } from 'vitest';
import { createStatusLineCommandModule } from '../statusline-command-module.js';

describe('createStatusLineCommandModule', () => {
  it('contributes a user-invocable statusline command source', () => {
    const module = createStatusLineCommandModule();
    const commands = module.commandSources?.flatMap((source) => source.getCommands()) ?? [];

    expect(commands).toContainEqual(
      expect.objectContaining({
        name: 'statusline',
        source: 'cli',
        modelInvocable: false,
      }),
    );
  });

  it('returns enabled=false for /statusline off', async () => {
    const command = createStatusLineCommandModule().systemCommands?.[0];

    const result = await command?.execute({} as Parameters<typeof command.execute>[0], 'off');

    expect(result).toEqual({
      success: true,
      message: 'Status line disabled.',
      data: { statuslinePatch: { enabled: false } },
    });
  });

  it('returns gitBranch=false for /statusline git off', async () => {
    const command = createStatusLineCommandModule().systemCommands?.[0];

    const result = await command?.execute({} as Parameters<typeof command.execute>[0], 'git off');

    expect(result).toEqual({
      success: true,
      message: 'Status line git branch hidden.',
      data: { statuslinePatch: { gitBranch: false } },
    });
  });

  it('reports usage for unsupported arguments', async () => {
    const command = createStatusLineCommandModule().systemCommands?.[0];

    const result = await command?.execute({} as Parameters<typeof command.execute>[0], 'wat');

    expect(result?.success).toBe(false);
    expect(result?.message).toContain('Usage: /statusline');
  });
});
