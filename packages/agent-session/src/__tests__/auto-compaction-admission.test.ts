import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONTEXT_WINDOW, registerModelMetadata } from '@robota-sdk/agent-core';

import { Session } from '../session.js';
import type { ISessionOptions } from '../session-types.js';
import type { IAIProvider, IChatOptions, IHookTypeExecutor, TUniversalMessage } from '@robota-sdk/agent-core';

const SMALL = 'auto-compact-small';
const LARGE = 'auto-compact-large';
registerModelMetadata(
  { id: SMALL, name: SMALL, contextWindow: 1000, maxOutput: 100 },
  { id: LARGE, name: LARGE, contextWindow: 2000, maxOutput: 100 },
);

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((session) => session.shutdown())); });

function fixture(options: Partial<ISessionOptions> = {}) {
  const requests: Array<{ messages: TUniversalMessage[]; options: IChatOptions }> = [];
  const defaultDeltas: string[] = [];
  const responseDeltas: string[] = [];
  const provider: IAIProvider = {
    name: 'admission-provider', version: '1', supportsTools: () => true, validateConfig: () => true,
    generateResponse: vi.fn(),
    async chat(messages, chatOptions = {}) {
      requests.push({ messages: structuredClone(messages), options: chatOptions });
      const content = chatOptions.toolChoice === 'none' ? 'compact summary' : 'normal response';
      // A wrapped provider's default callback is deliberately not a property of this wrapper.
      (chatOptions.onTextDelta ?? ((delta: string) => defaultDeltas.push(delta)))(content);
      return { id: randomUUID(), role: 'assistant', content, state: 'complete', timestamp: new Date() };
    },
  };
  const session = new Session({
    cwd: process.cwd(), tools: [], provider, model: SMALL, systemMessage: 'system',
    terminal: {
      write: vi.fn(), writeLine: vi.fn(), writeMarkdown: vi.fn(), writeError: vi.fn(),
      prompt: vi.fn(), select: vi.fn(), spinner: () => ({ stop: vi.fn(), update: vi.fn() }),
    },
    onTextDelta: (delta) => responseDeltas.push(delta),
    ...options,
  });
  sessions.push(session);
  return { session, provider, requests, defaultDeltas, responseDeltas };
}

function seed(session: Session, reportedTokens?: number): void {
  session.injectMessage('user', 'old request '.repeat(60));
  session.injectRawMessage({
    id: randomUUID(), role: 'assistant', content: 'old answer '.repeat(60),
    state: 'complete', timestamp: new Date(),
    ...(reportedTokens === undefined ? {} : { metadata: { inputTokens: reportedTokens, outputTokens: 0 } }),
  });
  session.syncContextFromHistory();
}

describe('automatic compaction admission', () => {
  it.each(['model', 'provider'] as const)('uses the current model window and summarizer after a %s switch', async (route) => {
    const { session, provider, requests } = fixture({ model: LARGE });
    seed(session, 900);
    const history = session.getHistory();
    if (route === 'model') await session.applyModelOptions({ model: SMALL });
    else session.swapProvider({ ...provider, name: 'next-provider' }, SMALL);

    expect(session.getContextState()).toMatchObject({ maxTokens: 1000, usedTokens: 900, usedPercentage: 90 });
    expect(session.getHistory()).toEqual(history);
    await expect(session.run('continue')).resolves.toBe('normal response');
    expect(requests).toHaveLength(2);
    expect(requests[0].options).toMatchObject({ model: SMALL, toolChoice: 'none' });
    expect(requests[1].options.model).toBe(SMALL);
  });

  it('preserves an explicit window and disabled policy while changing the summarizer model', async () => {
    const { session, requests } = fixture({ model: LARGE, contextMaxTokens: 1500, autoCompactThreshold: false });
    seed(session, 900);
    await session.applyModelOptions({ model: SMALL });
    expect(session.getContextState()).toMatchObject({ maxTokens: 1500, usedTokens: 900 });
    expect(session.getAutoCompactThreshold()).toBe(false);
    await session.run('continue');
    expect(requests).toHaveLength(1);
    await session.compact();
    expect(requests[1].options).toMatchObject({ model: SMALL, toolChoice: 'none' });
  });

  it('preserves usage and a changed threshold on effort-only updates and falls back for an unknown model', async () => {
    const { session } = fixture({ model: LARGE });
    seed(session, 900);
    session.setAutoCompactThreshold(0.6);
    const before = session.getContextState();
    await session.applyModelOptions({ effort: 'high' });
    expect(session.getContextState()).toEqual(before);
    await session.applyModelOptions({ model: 'auto-compact-unregistered' });
    expect(session.getContextState()).toMatchObject({ maxTokens: DEFAULT_CONTEXT_WINDOW, usedTokens: 900 });
    expect(session.getAutoCompactThreshold()).toBe(0.6);
  });

  it('compacts retained history before a large pending input crosses the hard capacity limit', async () => {
    const { session, requests } = fixture();
    seed(session);
    expect(session.getContextState().usedPercentage).toBeLessThan(83.5);
    const input = 'pending-input '.repeat(190);
    await expect(session.run(input)).resolves.toBe('normal response');
    expect(requests).toHaveLength(2);
    expect(requests[0].messages[0].content).not.toContain('pending-input');
    expect(requests[1].messages.filter((message) => message.content === input)).toHaveLength(1);
  });

  it('counts pending input on top of provider-reported usage that includes unseen request overhead', async () => {
    const { session, requests } = fixture();
    seed(session, 800);
    await expect(session.run('next '.repeat(30))).resolves.toBe('normal response');
    expect(requests).toHaveLength(2);
    expect(requests[0].options.toolChoice).toBe('none');
  });

  it('budgets hook output and transient system context without replaying the hook or summarizing either', async () => {
    const hook = vi.fn(async () => ({ outcome: 'allow' as const, source: 'command' as const, stdout: 'hook-only '.repeat(130) }));
    const { session, requests } = fixture({
      hooks: { UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: 'unused' }] }] },
      hookTypeExecutors: [{ type: 'command', execute: hook } as IHookTypeExecutor],
    });
    seed(session);
    const transient = 'transient-only '.repeat(70);
    await expect(session.run('continue', undefined, { ephemeralSystemContext: transient })).resolves.toBe('normal response');
    expect(hook).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
    expect(requests[0].messages[0].content).not.toMatch(/hook-only|transient-only/);
    expect(requests[1].messages.filter((message) => message.content === transient)).toHaveLength(1);
    expect(session.getHistory().some((message) => message.content === transient)).toBe(false);
  });

  it.each(['manual', 'auto'] as const)('keeps a wrapped provider default stream silent during %s compaction', async (trigger) => {
    const { session, requests, defaultDeltas, responseDeltas } = fixture();
    seed(session, 900);
    if (trigger === 'manual') await session.compact();
    else await session.run('continue');
    expect(requests[0].options.toolChoice).toBe('none');
    expect(defaultDeltas).toEqual([]);
    expect(responseDeltas).toEqual(trigger === 'auto' ? ['normal response'] : []);
  });

  it.each(['failure', 'empty', 'abort'] as const)('preserves retained history and tracking after summary %s at the pending-input boundary', async (outcome) => {
    const { session, provider } = fixture();
    seed(session);
    const history = session.getHistory();
    const state = session.getContextState();
    provider.chat = vi.fn(async (): Promise<TUniversalMessage> => {
      if (outcome === 'failure') throw new Error('summary failed');
      if (outcome === 'abort') session.abort();
      return { id: randomUUID(), role: 'assistant', content: '', state: 'complete', timestamp: new Date() };
    });
    await expect(session.run('pending-input '.repeat(190))).rejects.toThrow(
      outcome === 'failure' ? 'summary failed' : outcome === 'empty' ? /invalid summary/ : /abort/i,
    );
    expect(session.getHistory()).toEqual(history);
    expect(session.getContextState()).toEqual(state);
    expect(session.isRunning()).toBe(false);
  });

  it('honors disabled automatic compaction when new input exceeds capacity', async () => {
    const { session, requests } = fixture({ autoCompactThreshold: false });
    seed(session);
    await expect(session.run('pending-input '.repeat(190))).resolves.toMatch(/Context window is near capacity/);
    expect(requests).toHaveLength(0);
  });

  it.each(['manual', 'auto'] as const)('classifies provider rejection after %s cancellation as interruption and permits the next turn', async (trigger) => {
    const { session, provider } = fixture();
    seed(session, 900);
    const history = session.getHistory();
    const state = session.getContextState();
    const originalChat = provider.chat;
    let announceStarted = () => {};
    const started = new Promise<void>((resolve) => { announceStarted = resolve; });
    provider.chat = async (_messages, options) => new Promise<TUniversalMessage>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('Request was aborted.')), { once: true });
      announceStarted();
    });
    const operation = trigger === 'manual' ? session.compact() : session.run('continue');
    const rejection = expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    session.abort();
    await rejection;
    expect(session.getHistory()).toEqual(history);
    expect(session.getContextState()).toEqual(state);
    expect(session.isRunning()).toBe(false);

    provider.chat = originalChat;
    await expect(session.run('next turn')).resolves.toBe('normal response');
  });

  it('retains a provider failure mentioning abort when the turn was not cancelled', async () => {
    const { session, provider } = fixture();
    seed(session, 900);
    const failure = new Error('Request was aborted.');
    provider.chat = vi.fn(async () => { throw failure; });
    await expect(session.run('continue')).rejects.toBe(failure);
  });

  it.each(['model-request', 'model-failure', 'model-response'] as const)('preserves a %s journal failure racing cancellation', async (kind) => {
    const { session, provider } = fixture();
    seed(session, 900);
    const history = session.getHistory();
    const state = session.getContextState();
    if (kind === 'model-failure') provider.chat = vi.fn(async () => {
      session.abort();
      throw new Error('Request was aborted.');
    });
    await expect(session.run('continue', undefined, {
      executionJournal: {
        append: async (record) => {
          if (record.kind !== kind) return;
          session.abort();
          throw new Error('journal write failed');
        },
      },
    })).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED', kind });
    expect(session.getHistory()).toEqual(history);
    expect(session.getContextState()).toEqual(state);
    expect(session.isRunning()).toBe(false);
  });

  it('does not summarize an oversized first input when there is no retained conversation', async () => {
    const onCompact = vi.fn();
    const { session, requests } = fixture({ onCompact });
    await expect(session.run('oversized '.repeat(500))).resolves.toMatch(/Context window is near capacity/);
    expect(requests).toHaveLength(0);
    expect(onCompact).not.toHaveBeenCalled();
    expect(session.getHistory().filter((message) => message.role === 'user')).toHaveLength(1);
  });
});
