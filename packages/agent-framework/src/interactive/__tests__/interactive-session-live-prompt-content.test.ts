/**
 * Opt-in live prompt/response content: captured only for owner-typed turns, only when the host
 * provided a content port, carried in a batch of its own, and never touching the trace batch.
 */
import { describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';
import {
  LIVE_CONTENT_PRETRUNCATE_MARGIN_BYTES,
  LivePromptContentAccumulator,
  utf8Prefix,
} from '../interactive-session-live-prompt-content.js';

import type {
  ILivePromptContentBatch,
  ILivePromptContentPolicy,
  ILivePromptTraceBatch,
} from '@robota-sdk/agent-interface-analytics';
import type {
  IPromptHistoryEntry,
  IPromptHistoryWriter,
  ISubmitOptions,
} from '@robota-sdk/agent-interface-session';

type TListener = (event: string, data: Record<string, unknown>) => void;

function createMockSession(
  runImpl: (history: Array<{ role: string; content: string }>) => Promise<string>,
) {
  const history: Array<{ role: string; content: string }> = [];
  const session = {
    run: vi.fn().mockImplementation(() => runImpl(history)),
    abort: vi.fn(),
    getHistory: vi.fn().mockImplementation(() => history),
    getContextState: vi
      .fn()
      .mockReturnValue({ usedPercentage: 10, usedTokens: 1000, maxTokens: 200000 }),
    clearHistory: vi.fn(),
    getPermissionMode: vi.fn().mockReturnValue('default'),
    setPermissionMode: vi.fn(),
    getProviderId: vi.fn().mockReturnValue('test-provider'),
    getModelId: vi.fn().mockReturnValue('test-model'),
    getEventService: vi.fn().mockReturnValue({
      subscribe: vi.fn((_callback: TListener) => undefined),
      unsubscribe: vi.fn(),
    }),
    getSessionId: vi.fn().mockReturnValue('session.1'),
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getMessageCount: vi.fn().mockReturnValue(0),
    getSessionAllowedTools: vi.fn().mockReturnValue([]),
    compact: vi.fn(),
    injectMessage: vi.fn(),
    injectRawMessage: vi.fn(),
    syncContextFromHistory: vi.fn(),
  };
  return session;
}

const BOTH: ILivePromptContentPolicy = { userPrompts: true, assistantResponses: true, maxBytes: 2048 };

function build(
  options: {
    policy?: ILivePromptContentPolicy;
    withContent?: boolean;
    run?: (history: Array<{ role: string; content: string }>) => Promise<string>;
    promptHistory?: IPromptHistoryWriter;
  } = {},
) {
  const traces: ILivePromptTraceBatch[] = [];
  const contents: ILivePromptContentBatch[] = [];
  const onFailure = vi.fn();
  const mock = createMockSession(options.run ?? (async () => 'the answer'));
  const session = new InteractiveSession({
    session: mock as never,
    cwd: '/tmp',
    livePromptTrace: {
      enqueue: (batch) => void traces.push(batch),
      onFailure,
      ...(options.withContent === false
        ? {}
        : {
            content: {
              policy: options.policy ?? BOTH,
              enqueue: (batch: ILivePromptContentBatch) => void contents.push(batch),
            },
          }),
    },
    ...(options.promptHistory
      ? { promptHistory: { writer: options.promptHistory, project: '/tmp' } }
      : {}),
  });
  return { session, traces, contents, onFailure, mock };
}

describe('live prompt content capture', () => {
  it('captures the typed text and the response of an owner turn, joined to its trace root', async () => {
    const { session, traces, contents } = build();
    await session.submit('expanded @file body', undefined, 'what I typed');
    expect(contents).toHaveLength(1);
    const batch = contents[0]!;
    expect(batch.root.traceId).toBe(traces[0]!.root.traceId);
    expect(batch.root.spanId).toBe(traces[0]!.root.spanId);
    expect(batch.root.endedAt).toBe(traces[0]!.root.endedAt);
    expect(batch.items).toEqual([
      { kind: 'user-prompt', text: 'what I typed', originalBytes: 12, truncated: false },
      { kind: 'assistant-response', text: 'the answer', originalBytes: 10, truncated: false },
    ]);
  });

  it('honours each gate on its own', async () => {
    const prompts = build({ policy: { ...BOTH, assistantResponses: false } });
    await prompts.session.submit('hello');
    expect(prompts.contents[0]!.items.map((item) => item.kind)).toEqual(['user-prompt']);
    const responses = build({ policy: { ...BOTH, userPrompts: false } });
    await responses.session.submit('hello');
    expect(responses.contents[0]!.items.map((item) => item.kind)).toEqual(['assistant-response']);
  });

  it('skips the synthetic empty-response placeholder', async () => {
    const { session, contents } = build({ run: async () => '' });
    await session.submit('hello');
    expect(contents[0]!.items.map((item) => item.kind)).toEqual(['user-prompt']);
  });

  it('marks an interrupted turn response partial, which is not truncated', async () => {
    const { session, contents } = build({
      run: async (history) => {
        history.push({ role: 'assistant', content: 'half an answer' });
        throw Object.assign(new Error('stopped'), { name: 'AbortError' });
      },
    });
    await session.submit('hello');
    expect(contents[0]!.items[1]).toEqual({
      kind: 'assistant-response',
      text: 'half an answer',
      originalBytes: 14,
      truncated: false,
      partial: true,
    });
  });

  it.each<[string, ISubmitOptions]>([
    ['a remote co-driver', { driverId: 'device-42' }],
    ['a peer', { turnSource: 'peer', driverId: 'peer:session_b' }],
    ['an agent wakeup', { turnSource: 'agent-wakeup', driverId: 'agent' }],
  ])('captures nothing for %s turn', async (_label, submitOptions) => {
    const { session, contents, traces } = build();
    await session.submit('not the owner', undefined, undefined, submitOptions);
    expect(traces).toHaveLength(1);
    expect(contents).toHaveLength(0);
  });

  it('agrees with prompt history on which turns are the owner’s', async () => {
    const entries: IPromptHistoryEntry[] = [];
    const { session, contents } = build({
      promptHistory: { append: (entry) => void entries.push(entry) },
    });
    const cases: Array<[string, ISubmitOptions]> = [
      ['owner-a', {}],
      ['remote', { driverId: 'device-42' }],
      ['owner-b', { driverId: 'owner' }],
      ['peer', { turnSource: 'peer', driverId: 'peer:session_b' }],
      ['wake', { turnSource: 'agent-wakeup', driverId: 'agent' }],
    ];
    for (const [text, submitOptions] of cases) await session.submit(text, undefined, undefined, submitOptions);
    const captured = contents.map((batch) => batch.items.find((item) => item.kind === 'user-prompt')?.text);
    expect(captured).toEqual(entries.map((entry) => entry.text));
    expect(captured).toEqual(['owner-a', 'owner-b']);
  });

  it('copies no text at all when the host provided no content port or turned both gates off', async () => {
    const addPrompt = vi.spyOn(LivePromptContentAccumulator.prototype, 'addPrompt');
    const addResponse = vi.spyOn(LivePromptContentAccumulator.prototype, 'addResponse');
    try {
      const none = build({ withContent: false });
      await none.session.submit('hello');
      const off = build({ policy: { ...BOTH, userPrompts: false, assistantResponses: false } });
      await off.session.submit('hello');
      expect(addPrompt).not.toHaveBeenCalled();
      expect(addResponse).not.toHaveBeenCalled();
      expect(off.contents).toHaveLength(0);
      // The spies do see an enabled port, so their silence above is meaningful.
      const on = build();
      await on.session.submit('hello');
      expect(addPrompt).toHaveBeenCalledTimes(1);
    } finally {
      addPrompt.mockRestore();
      addResponse.mockRestore();
    }
  });

  it('leaves the trace batch exactly as it is without a content port', async () => {
    const normalize = (batch: ILivePromptTraceBatch) => ({
      ...batch,
      turnId: '<turn>',
      root: { ...batch.root, traceId: '<t>', spanId: '<s>', startedAt: '<a>', endedAt: '<b>' },
    });
    const withContent = build();
    await withContent.session.submit('hello');
    const without = build({ withContent: false });
    await without.session.submit('hello');
    expect(normalize(withContent.traces[0]!)).toEqual(normalize(without.traces[0]!));
    expect(JSON.stringify(withContent.traces[0])).not.toContain('hello');
    expect(JSON.stringify(withContent.traces[0])).not.toContain('the answer');
  });

  it('isolates a throwing content port from the turn and from the trace batch', async () => {
    const traces: ILivePromptTraceBatch[] = [];
    const onFailure = vi.fn();
    const session = new InteractiveSession({
      session: createMockSession(async () => 'ok') as never,
      cwd: '/tmp',
      livePromptTrace: {
        enqueue: (batch) => void traces.push(batch),
        onFailure,
        content: {
          policy: BOTH,
          enqueue: () => {
            throw new Error('queue full');
          },
        },
      },
    });
    const handle = await session.submit('hello');
    await expect(handle.completed).resolves.toBeDefined();
    expect(traces).toHaveLength(1);
    expect(onFailure).toHaveBeenCalledWith('enqueue-failed');
  });

  it('pre-truncates with a margin above the host bound, on a UTF-8 boundary', async () => {
    const maxBytes = 256;
    const typed = '😀'.repeat(400); // 1600 bytes, four per character
    const { session, contents } = build({ policy: { ...BOTH, maxBytes } });
    await session.submit(typed);
    const prompt = contents[0]!.items[0]!;
    expect(prompt.truncated).toBe(true);
    expect(prompt.originalBytes).toBe(1600);
    const kept = Buffer.byteLength(prompt.text, 'utf8');
    expect(kept).toBeLessThanOrEqual(maxBytes + LIVE_CONTENT_PRETRUNCATE_MARGIN_BYTES);
    expect(kept).toBeGreaterThan(maxBytes + LIVE_CONTENT_PRETRUNCATE_MARGIN_BYTES - 4);
    expect(prompt.text).not.toContain('\uFFFD');
    expect(utf8Prefix('a😀', 3)).toBe('a');
  });
});
