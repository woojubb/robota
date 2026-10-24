import { describe, expect, it, vi } from 'vitest';
import type { ITerminalOutput, TProviderOwnership } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { Session } from '../session';

function client() {
  const scripted = createScriptedProvider([{ text: 'still available' }]);
  const close = vi.fn(async () => {});
  const chat = scripted.provider.chat.bind(scripted.provider);
  return {
    close,
    provider: Object.assign(scripted.provider, {
      close,
      async chat(...args: Parameters<typeof chat>) {
        if (close.mock.calls.length) throw new Error('provider closed');
        return chat(...args);
      },
    }),
  };
}

const terminal: ITerminalOutput = {
  write() {},
  writeLine() {},
  writeMarkdown() {},
  writeError() {},
  prompt: async () => '',
  select: async () => 0,
  spinner: () => ({ stop() {}, update() {} }),
};

describe('Session provider ownership', () => {
  const choices: Array<TProviderOwnership | undefined> = [undefined, 'borrowed'];
  it.each(choices)(
    'uses %s ownership or the owned default through real shutdown',
    async (ownership) => {
      const previous = client();
      const next = client();
      const session = new Session({
        cwd: process.cwd(),
        tools: [],
        provider: previous.provider,
        providerOwnership: 'borrowed',
        systemMessage: 'Fixture',
        terminal,
        model: 'initial',
        autoCompactThreshold: false,
      });
      session.swapProvider(
        next.provider,
        'replacement',
        ownership === undefined ? undefined : { ownership },
      );
      expect(session.getModelId()).toBe('replacement');
      await session.shutdown();
      expect(previous.close).not.toHaveBeenCalled();
      if (ownership === 'borrowed') {
        expect(next.close).not.toHaveBeenCalled();
        expect(await next.provider.chat([])).toMatchObject({ content: 'still available' });
        await next.provider.close();
      } else {
        expect(next.close).toHaveBeenCalledOnce();
        await expect(next.provider.chat([])).rejects.toThrow('provider closed');
      }
      expect(next.close).toHaveBeenCalledOnce();
      await previous.provider.close();
    },
  );
});
