import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { FileSystemMemoryStore, createFileSystemMemoryStore } from '../file-system-memory-store.js';
import { MemoryPolicyEvaluator } from '../memory-policy-evaluator.js';

import type {
  IMemoryStore,
  IMemoryBudget,
  IMemoryCandidate,
  ISemanticMemoryAdapter,
} from '../types.js';

const TMP_BASE = join(tmpdir(), `robota-fs-memory-store-${process.pid}`);

function makeWorkspace(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function candidate(overrides: Partial<IMemoryCandidate> = {}): IMemoryCandidate {
  return {
    id: 'cand-1',
    type: 'project',
    topic: 'build',
    text: 'use pnpm build:deps before tests',
    sourceMessageIds: ['m1'],
    confidence: 0.9,
    createdAt: '2026-07-18T00:00:00.000Z',
    reason: 'observed',
    ...overrides,
  };
}

afterEach(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

describe('SELFHOST-008 TC-01 — durable round-trip across sessions (async port)', () => {
  it('recalls a fact written in one store from a FRESH store over the same workspace', async () => {
    const cwd = makeWorkspace();

    const writer = createFileSystemMemoryStore(cwd);
    await writer.append({
      type: 'project',
      topic: 'build',
      text: 'run pnpm build:deps before tests',
    });

    const reader = createFileSystemMemoryStore(cwd);
    const recalled = await reader.recall('build deps tests', { maxTopics: 5, maxTopicChars: 500 });

    expect(recalled.content).toContain('build:deps');
    expect(recalled.references.map((r) => r.topic)).toContain('build');
    expect((await reader.loadStartupMemory()).content).toContain('build:deps');
  });
});

describe('SELFHOST-008 TC-02 — budgeted recall (ranked, never over budget)', () => {
  it('returns at most maxTopics and truncates each topic to maxTopicChars', async () => {
    const cwd = makeWorkspace();
    const store = createFileSystemMemoryStore(cwd);
    await store.append({ type: 'project', topic: 'alpha-one', text: `alpha ${'x'.repeat(400)}` });
    await store.append({ type: 'project', topic: 'alpha-two', text: `alpha ${'y'.repeat(400)}` });
    await store.append({ type: 'project', topic: 'alpha-three', text: `alpha ${'z'.repeat(400)}` });

    const budget: IMemoryBudget = { maxTopics: 2, maxTopicChars: 50 };
    const result = await store.recall('alpha', budget);

    expect(result.references.length).toBe(2);
    for (const ref of result.references) {
      expect((await store.readTopic(ref.topic)).length).toBeGreaterThan(budget.maxTopicChars);
    }
    expect(result.truncated).toBe(true);
  });

  it('returns empty for a query with no matching topics', async () => {
    const store = createFileSystemMemoryStore(makeWorkspace());
    await store.append({ type: 'project', topic: 'build', text: 'pnpm' });
    expect(
      (await store.recall('nonmatchingtoken', { maxTopics: 5, maxTopicChars: 100 })).references,
    ).toEqual([]);
  });
});

describe('SELFHOST-008 TC-05 (P1R) — recall seam cleaned: injected clock reaches the recall read path', () => {
  it('FileSystemMemoryStore holds one ProjectMemoryStore honoring the injected now', async () => {
    const cwd = makeWorkspace();
    const fixed = new Date('2026-07-18T09:00:00.000Z');
    const store = createFileSystemMemoryStore(cwd, () => fixed);
    await store.append({ type: 'project', topic: 'clock', text: 'injected-clock-entry' });
    // the recalled entry is date-stamped with the injected clock (2026-07-18), proving the recall read
    // path uses the same injected-clock ProjectMemoryStore (not a second default-clock instance).
    const recalled = await store.recall('clock injected entry', {
      maxTopics: 3,
      maxTopicChars: 500,
    });
    expect(recalled.content).toContain('2026-07-18');
    expect(recalled.content).toContain('injected-clock-entry');
  });
});

describe('SELFHOST-008 TC-04 — curate queue + sensitive-content refusal', () => {
  it('queues and transitions pending candidates through the port', async () => {
    const store = createFileSystemMemoryStore(makeWorkspace());
    await store.upsertPending(candidate(), 'pending', 'queued for review');

    expect((await store.listPending('pending')).map((r) => r.id)).toContain('cand-1');
    const marked = await store.markPending('cand-1', 'approved', 'looks good');
    expect(marked.status).toBe('approved');
    expect((await store.getPending('cand-1'))?.status).toBe('approved');
  });

  it('the neutral default policy REFUSES sensitive content (skip / sensitive-content)', () => {
    const evaluator = new MemoryPolicyEvaluator();
    const decision = evaluator.evaluate(
      candidate({ text: 'my api_key is sk-live-123 and password is hunter2' }),
      { policy: 'auto_save', retrieval: { maxTopics: 5, maxTopicChars: 100 } },
    );
    expect(decision.action).toBe('skip');
    expect(decision.reason).toBe('sensitive-content');
  });
});

describe('SELFHOST-008 TC-02 (P1R) — async adapter swap needs no library change; semantic seam functions', () => {
  it('a fake ASYNC IMemoryStore satisfies the port with no agent-framework edit', async () => {
    const recalls: string[] = [];
    const fake: IMemoryStore = {
      loadStartupMemory: async () => ({
        content: 'FAKE',
        path: '/fake',
        lineCount: 1,
        truncated: false,
      }),
      list: async () => ({ indexPath: '/fake', topicsPath: '/fake/topics', topics: [] }),
      readTopic: async () => '',
      append: async (input) => ({
        indexPath: '/fake',
        topicPath: '/fake/topics/x.md',
        topic: input.topic,
        deduplicated: false,
      }),
      recall: async (query) => {
        recalls.push(query);
        return { content: 'FAKE-RECALL', references: [], truncated: false };
      },
      getPending: async () => undefined,
      listPending: async () => [],
      markPending: async (id, status, reason) => ({
        id,
        type: 'project',
        topic: 't',
        text: 'x',
        sourceMessageIds: [],
        confidence: 1,
        createdAt: '2026-07-18T00:00:00.000Z',
        reason,
        status,
        updatedAt: '2026-07-18T00:00:00.000Z',
      }),
      upsertPending: async () => undefined,
    };

    const store: IMemoryStore = fake;
    expect((await store.loadStartupMemory()).content).toBe('FAKE');
    expect((await store.recall('q', { maxTopics: 1, maxTopicChars: 1 })).content).toBe(
      'FAKE-RECALL',
    );
    expect(recalls).toEqual(['q']);
  });

  it('an IMemoryStore backed by a fake async ISemanticMemoryAdapter is injectable (ghost-seam closed)', async () => {
    // A surface can back the async port with a semantic adapter — the whole point of the async remediation.
    const semantic: ISemanticMemoryAdapter = {
      index: async () => undefined,
      query: async (text) => ({ content: `semantic:${text}`, references: [] }),
    };
    const base = createFileSystemMemoryStore(makeWorkspace());
    const semanticBacked: IMemoryStore = {
      ...base,
      loadStartupMemory: () => base.loadStartupMemory(),
      list: () => base.list(),
      readTopic: (t) => base.readTopic(t),
      append: async (input) => {
        await semantic.index(input); // dual-write to the vector backend
        return base.append(input);
      },
      recall: async (query, budget) => ({
        ...(await semantic.query(query, budget)),
        truncated: false,
      }), // semantic recall
      getPending: (id) => base.getPending(id),
      listPending: (s) => base.listPending(s),
      markPending: (id, s, r) => base.markPending(id, s, r),
      upsertPending: (c, s, r) => base.upsertPending(c, s, r),
    };
    await semanticBacked.append({ type: 'project', topic: 't', text: 'x' });
    expect((await semanticBacked.recall('q', { maxTopics: 1, maxTopicChars: 1 })).content).toBe(
      'semantic:q',
    );
  });
});

describe('SELFHOST-008 TC-03 (capture half) — AutomaticMemoryController routes through the injected port', () => {
  it('an injected IMemoryStore receives the capture write', async () => {
    const { AutomaticMemoryController } = await import('../automatic-memory-controller.js');
    const appended: string[] = [];
    const pending: string[] = [];
    const base = createFileSystemMemoryStore(makeWorkspace());
    const spy: IMemoryStore = {
      loadStartupMemory: () => base.loadStartupMemory(),
      list: () => base.list(),
      readTopic: (topic) => base.readTopic(topic),
      recall: (query, budget) => base.recall(query, budget),
      getPending: (id) => base.getPending(id),
      listPending: (status) => base.listPending(status),
      markPending: (id, status, reason) => base.markPending(id, status, reason),
      append: async (input) => {
        appended.push(input.text);
        return base.append(input);
      },
      upsertPending: async (c, status, reason) => {
        pending.push(`${c.id}:${status}`);
        await base.upsertPending(c, status, reason);
      },
    };

    const controller = new AutomaticMemoryController({
      cwd: makeWorkspace(),
      config: { policy: 'auto_save', retrieval: { maxTopics: 3, maxTopicChars: 3000 } },
      memoryStore: spy,
      extractor: { extract: () => [candidate({ confidence: 0.99, text: 'stored via port' })] },
    });

    const result = await controller.capture({
      sessionId: 's1',
      turnId: 't1',
      userMessage: 'u',
      assistantMessage: 'a',
    });

    expect(result.saved).toContain('cand-1');
    expect(appended).toContain('stored via port');
    expect(pending).toContain('cand-1:saved');
  });
});

describe('SELFHOST-008 — FileSystemMemoryStore is the neutral reference adapter', () => {
  it('is an IMemoryStore and composes the existing fs mechanisms without new behavior', async () => {
    const store = new FileSystemMemoryStore(makeWorkspace());
    await store.append({ type: 'reference', topic: 'docs', text: 'see AGENTS.md' });
    expect((await store.list()).topics.map((t) => t.name)).toContain('docs');
  });
});
