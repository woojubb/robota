import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';
import { createProjectSessionStore } from '../session-persistence.js';

import type {
  IMemoryStore,
  IMemoryBudget,
  IMemoryRetrievalResult,
  IPerTurnRecallConfig,
} from '../../memory/types.js';
import type { IAIProvider, TUniversalMessage } from '@robota-sdk/agent-core';

/**
 * SELFHOST-008 P3 — per-turn recall wired into the live turn: query = the turn input, rendered under a
 * distinct `<recalled-memory>` label, injected EPHEMERALLY into that turn's model call (never persisted),
 * adapter-gated on a surface-supplied `recallMemory` policy, guarded (recall failure never breaks the turn).
 */

const TMP_BASE = join(tmpdir(), `robota-recall-${process.pid}`);
const ORIGINAL_HOME = process.env.HOME;
const RECALL_BODY = '### deploy\nThe staging deploy key rotates every 30 days.';
const BUDGET: IMemoryBudget = { maxTopics: 4, maxTopicChars: 2000 };

function makeProject(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Records every messages array the model was called with, so we can assert what reached the provider. */
function createProvider(): { provider: IAIProvider; calls: TUniversalMessage[][] } {
  const calls: TUniversalMessage[][] = [];
  const provider = {
    name: 'mock',
    version: 'test',
    chat: vi.fn(async (messages: TUniversalMessage[]) => {
      calls.push([...messages]);
      return { role: 'assistant', content: 'ok', timestamp: new Date('2026-05-02T00:00:00.000Z') };
    }),
    generateResponse: vi.fn(),
  } as unknown as IAIProvider;
  return { provider, calls };
}

/** A neutral fake IMemoryStore. `recall` is a spy returning a canned hit (or throwing for the guard test). */
function createFakeStore(
  recall: (query: string, budget: IMemoryBudget) => Promise<IMemoryRetrievalResult>,
): IMemoryStore {
  const empty = { content: '', references: [], truncated: false } as IMemoryRetrievalResult;
  return {
    loadStartupMemory: async () => ({ content: '', references: [] }),
    list: async () => ({ topics: [], indexPath: '', hasIndex: false }),
    readTopic: async () => '',
    append: async () => ({ topic: 'x', path: 'x', deduplicated: false }),
    recall: vi.fn(recall),
    getPending: async () => undefined,
    listPending: async () => [],
    markPending: async () => ({}) as never,
    upsertPending: async () => {},
  } as unknown as IMemoryStore;
}

const RECALL_ON: IPerTurnRecallConfig = { budget: BUDGET };

beforeEach(() => {
  const home = join(TMP_BASE, 'home');
  mkdirSync(home, { recursive: true });
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = ORIGINAL_HOME;
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

describe('SELFHOST-008 P3 — per-turn recall wiring', () => {
  it('TC-01: with a recallMemory policy, a turn recalls (query=input) and the block reaches the model', async () => {
    const cwd = makeProject();
    const { provider, calls } = createProvider();
    const store = createFakeStore(async () => ({
      content: RECALL_BODY,
      references: [{ topic: 'deploy', path: 'deploy.md', score: 5, truncated: false }],
      truncated: false,
    }));
    const session = new InteractiveSession({
      cwd,
      provider,
      bare: true,
      memoryStore: store,
      recallMemory: RECALL_ON,
    });

    await session.submit('how do I rotate the deploy key?');

    expect(store.recall).toHaveBeenCalledWith('how do I rotate the deploy key?', BUDGET);
    const systemBlocks = calls[0].filter((m) => m.role === 'system');
    expect(systemBlocks.some((m) => (m.content ?? '').includes('<recalled-memory>'))).toBe(true);
    expect(systemBlocks.some((m) => (m.content ?? '').includes('staging deploy key'))).toBe(true);
  });

  it('TC-02: the recalled block is EPHEMERAL — absent from the persisted session record', async () => {
    const cwd = makeProject();
    const sessionStore = createProjectSessionStore(cwd);
    const { provider } = createProvider();
    const store = createFakeStore(async () => ({
      content: RECALL_BODY,
      references: [{ topic: 'deploy', path: 'deploy.md', score: 5, truncated: false }],
      truncated: false,
    }));
    const session = new InteractiveSession({
      cwd,
      provider,
      bare: true,
      sessionStore,
      memoryStore: store,
      recallMemory: RECALL_ON,
    });

    await session.submit('rotate the deploy key');

    const saved = sessionStore.load(session.getSession().getSessionId());
    // whole persisted record must not contain the ephemeral recall marker or body
    expect(JSON.stringify(saved ?? {})).not.toContain('recalled-memory');
    expect(JSON.stringify(saved ?? {})).not.toContain('staging deploy key');
  });

  it('TC-04: adapter-gating — no recallMemory policy ⇒ no recall call, no block', async () => {
    const cwd = makeProject();
    const { provider, calls } = createProvider();
    const store = createFakeStore(async () => ({
      content: RECALL_BODY,
      references: [],
      truncated: false,
    }));
    const session = new InteractiveSession({ cwd, provider, bare: true, memoryStore: store });

    await session.submit('rotate the deploy key');

    expect(store.recall).not.toHaveBeenCalled();
    const systemBlocks = calls[0].filter((m) => m.role === 'system');
    expect(systemBlocks.some((m) => (m.content ?? '').includes('<recalled-memory>'))).toBe(false);
  });

  it('TC-05: guarded — a recall that THROWS does not fail the turn (no block, turn completes)', async () => {
    const cwd = makeProject();
    const { provider, calls } = createProvider();
    const store = createFakeStore(async () => {
      throw new Error('semantic backend unavailable');
    });
    const session = new InteractiveSession({
      cwd,
      provider,
      bare: true,
      memoryStore: store,
      recallMemory: RECALL_ON,
    });

    await expect(session.submit('rotate the deploy key')).resolves.not.toThrow();
    expect(provider.chat).toHaveBeenCalledTimes(1); // the turn still ran
    const systemBlocks = calls[0].filter((m) => m.role === 'system');
    expect(systemBlocks.some((m) => (m.content ?? '').includes('<recalled-memory>'))).toBe(false);
  });

  it('TC-06: recall is called with the surface-supplied budget', async () => {
    const cwd = makeProject();
    const { provider } = createProvider();
    const recallSpy = vi.fn(async () => ({ content: '', references: [], truncated: false }));
    const store = createFakeStore(recallSpy);
    const session = new InteractiveSession({
      cwd,
      provider,
      bare: true,
      memoryStore: store,
      recallMemory: { budget: { maxTopics: 2, maxTopicChars: 500 } },
    });

    await session.submit('anything');

    expect(recallSpy).toHaveBeenCalledWith('anything', { maxTopics: 2, maxTopicChars: 500 });
  });
});
