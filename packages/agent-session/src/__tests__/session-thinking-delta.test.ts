import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScriptedProvider, type TScriptedTurn } from '@robota-sdk/agent-core/testing';
import { Session } from '../session.js';
import type { ISessionOptions } from '../session-types.js';

const sessions: Session[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
});

function fixture(turns: TScriptedTurn[], options: Partial<ISessionOptions> = {}) {
  const scripted = createScriptedProvider(turns);
  const session = new Session({
    cwd: '/tmp',
    systemMessage: 'Fixture',
    model: 'test-model',
    provider: scripted.provider,
    autoCompactThreshold: false,
    terminal: {
      write: vi.fn(),
      writeLine: vi.fn(),
      writeMarkdown: vi.fn(),
      writeError: vi.fn(),
      prompt: vi.fn(async () => ''),
      select: vi.fn(async () => 0),
      spinner: vi.fn(() => ({ stop: vi.fn(), update: vi.fn() })),
    },
    tools: [],
    ...options,
  });
  sessions.push(session);
  return session;
}

describe('Session onThinkingDelta', () => {
  it('hands the provider reasoning text to the session option and keeps it out of the reply', async () => {
    const thoughts: string[] = [];
    const replyDeltas: string[] = [];
    const session = fixture([{ thinking: 'checking the premise', text: 'It holds.' }], {
      onThinkingDelta: (delta) => thoughts.push(delta),
      onTextDelta: (delta) => replyDeltas.push(delta),
    });

    const reply = await session.run('is it true?');

    expect(thoughts).toEqual(['checking the premise']);
    expect(reply).toBe('It holds.');
    expect(replyDeltas).toEqual(['It holds.']);
  });

  it('calls it for no turn when the provider sends no reasoning text', async () => {
    const onThinkingDelta = vi.fn();
    const session = fixture([{ text: 'plain' }], { onThinkingDelta });

    await session.run('hello');

    expect(onThinkingDelta).not.toHaveBeenCalled();
  });

  it('runs a session that registered no reasoning callback', async () => {
    const session = fixture([{ thinking: 'unobserved', text: 'fine' }]);

    await expect(session.run('hello')).resolves.toBe('fine');
  });
});
