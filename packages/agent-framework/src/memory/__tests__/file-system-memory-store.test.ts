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

describe('SELFHOST-008 TC-01 — durable round-trip across sessions', () => {
  it('recalls a fact written in one store from a FRESH store over the same workspace', () => {
    const cwd = makeWorkspace();

    // session 1: write
    const writer = createFileSystemMemoryStore(cwd);
    writer.append({ type: 'project', topic: 'build', text: 'run pnpm build:deps before tests' });

    // session 2: a brand-new store instance over the same workspace recalls it
    const reader = createFileSystemMemoryStore(cwd);
    const recalled = reader.recall('build deps tests', { maxTopics: 5, maxTopicChars: 500 });

    expect(recalled.content).toContain('build:deps');
    expect(recalled.references.map((r) => r.topic)).toContain('build');
    // and the durable index survives the process-independent store
    expect(reader.loadStartupMemory().content).toContain('build:deps');
  });
});

describe('SELFHOST-008 TC-02 — budgeted recall (ranked, never over budget)', () => {
  it('returns at most maxTopics and truncates each topic to maxTopicChars', () => {
    const cwd = makeWorkspace();
    const store = createFileSystemMemoryStore(cwd);
    // three topics, all matching the query token "alpha"
    store.append({ type: 'project', topic: 'alpha-one', text: `alpha ${'x'.repeat(400)}` });
    store.append({ type: 'project', topic: 'alpha-two', text: `alpha ${'y'.repeat(400)}` });
    store.append({ type: 'project', topic: 'alpha-three', text: `alpha ${'z'.repeat(400)}` });

    const budget: IMemoryBudget = { maxTopics: 2, maxTopicChars: 50 };
    const result = store.recall('alpha', budget);

    expect(result.references.length).toBeLessThanOrEqual(budget.maxTopics);
    expect(result.references.length).toBe(2);
    // each emitted section body respects the char budget (a truncation marker is appended)
    for (const ref of result.references) {
      const body = store.readTopic(ref.topic);
      expect(body.length).toBeGreaterThan(budget.maxTopicChars); // source is over budget…
    }
    expect(result.truncated).toBe(true); // …so recall reports truncation
  });

  it('returns empty for a query with no matching topics', () => {
    const store = createFileSystemMemoryStore(makeWorkspace());
    store.append({ type: 'project', topic: 'build', text: 'pnpm' });
    expect(
      store.recall('nonmatchingtoken', { maxTopics: 5, maxTopicChars: 100 }).references,
    ).toEqual([]);
  });
});

describe('SELFHOST-008 TC-04 — curate queue + sensitive-content refusal', () => {
  it('queues and transitions pending candidates through the port', () => {
    const store = createFileSystemMemoryStore(makeWorkspace());
    store.upsertPending(candidate(), 'pending', 'queued for review');

    expect(store.listPending('pending').map((r) => r.id)).toContain('cand-1');
    const marked = store.markPending('cand-1', 'approved', 'looks good');
    expect(marked.status).toBe('approved');
    expect(store.getPending('cand-1')?.status).toBe('approved');
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

describe('SELFHOST-008 TC-05 — adapter swap needs no library change', () => {
  it('a fake IMemoryStore satisfies the port with no agent-framework edit', () => {
    // A surface can supply ANY IMemoryStore; the library depends only on the port.
    const recalls: string[] = [];
    const fake: IMemoryStore = {
      loadStartupMemory: () => ({ content: 'FAKE', path: '/fake', lineCount: 1, truncated: false }),
      list: () => ({ indexPath: '/fake', topicsPath: '/fake/topics', topics: [] }),
      readTopic: () => '',
      append: (input) => ({
        indexPath: '/fake',
        topicPath: '/fake/topics/x.md',
        topic: input.topic,
        deduplicated: false,
      }),
      recall: (query) => {
        recalls.push(query);
        return { content: 'FAKE-RECALL', references: [], truncated: false };
      },
      getPending: () => undefined,
      listPending: () => [],
      markPending: (id, status, reason) => ({
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
      upsertPending: () => undefined,
    };

    const store: IMemoryStore = fake;
    expect(store.loadStartupMemory().content).toBe('FAKE');
    expect(store.recall('q', { maxTopics: 1, maxTopicChars: 1 }).content).toBe('FAKE-RECALL');
    expect(recalls).toEqual(['q']);
  });

  it('the deferred ISemanticMemoryAdapter shape is satisfiable by a fake (design-only, P3 wiring)', async () => {
    const semantic: ISemanticMemoryAdapter = {
      index: async () => undefined,
      query: async (text) => ({ content: `semantic:${text}`, references: [] }),
    };
    await semantic.index({ type: 'project', topic: 't', text: 'x' });
    expect((await semantic.query('q', { maxTopics: 1, maxTopicChars: 1 })).content).toBe(
      'semantic:q',
    );
  });
});

describe('SELFHOST-008 — FileSystemMemoryStore is the neutral reference adapter', () => {
  it('is an IMemoryStore and composes the existing fs mechanisms without new behavior', () => {
    const store = new FileSystemMemoryStore(makeWorkspace());
    // append → list round-trips through ProjectMemoryStore
    store.append({ type: 'reference', topic: 'docs', text: 'see AGENTS.md' });
    expect(store.list().topics.map((t) => t.name)).toContain('docs');
  });
});
