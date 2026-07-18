import { describe, expect, it, vi } from 'vitest';

import { AutomaticMemoryController } from '../automatic-memory-controller.js';
import { createSemanticMemoryStore, SemanticMemoryStore } from '../semantic-memory-store.js';

import type {
  IAppendMemoryResult,
  IMemoryBudget,
  IMemoryRetrievalResult,
  IMemoryStore,
  ISemanticMemoryAdapter,
} from '../types.js';

/**
 * SELFHOST-008 P4 — the semantic-memory adapter decorator: tiered recall (semantic primary, keyword fallback),
 * guarded append-then-index (skip on dedup), delegate rest; adapter-gated by composition; neutral.
 */

const BUDGET: IMemoryBudget = { maxTopics: 4, maxTopicChars: 2000 };
const KEYWORD: IMemoryRetrievalResult = {
  content: '### keyword\nkeyword-ranked hit',
  references: [{ topic: 'keyword', path: 'k.md', score: 1, truncated: false }],
  truncated: false,
};

/** A fake base IMemoryStore with spies; `recall` returns the keyword result; `append` dedup flag configurable. */
function createFakeBase(overrides: { deduplicated?: boolean } = {}): IMemoryStore {
  return {
    loadStartupMemory: vi.fn(async () => ({ content: '', references: [] })),
    list: vi.fn(async () => ({ topics: [], indexPath: '', hasIndex: false })),
    readTopic: vi.fn(async () => ''),
    append: vi.fn(
      async (): Promise<IAppendMemoryResult> => ({
        indexPath: 'i',
        topicPath: 't',
        topic: 'x',
        deduplicated: overrides.deduplicated ?? false,
      }),
    ),
    recall: vi.fn(async () => KEYWORD),
    getPending: vi.fn(async () => undefined),
    listPending: vi.fn(async () => []),
    markPending: vi.fn(async () => ({}) as never),
    upsertPending: vi.fn(async () => {}),
  } as unknown as IMemoryStore;
}

/** A fake semantic adapter; `query`/`index` behavior injectable. */
function createFakeAdapter(
  query: (t: string, b: IMemoryBudget) => Promise<{ content: string; references: [] }>,
  index: () => Promise<void> = async () => {},
): ISemanticMemoryAdapter {
  return { query: vi.fn(query), index: vi.fn(index) } as unknown as ISemanticMemoryAdapter;
}

const SEMANTIC_HIT = { content: '<semantic body>', references: [] as [] };

describe('SELFHOST-008 P4 — SemanticMemoryStore decorator', () => {
  it('TC-01: adapter present ⇒ recall returns the semantic query() result, not keyword', async () => {
    const base = createFakeBase();
    const adapter = createFakeAdapter(async () => SEMANTIC_HIT);
    const store = createSemanticMemoryStore(base, adapter);

    const result = await store.recall('paraphrased query', BUDGET);

    expect(adapter.query).toHaveBeenCalledWith('paraphrased query', BUDGET);
    expect(result.content).toBe('<semantic body>');
    expect(base.recall).not.toHaveBeenCalled(); // semantic is primary, keyword not consulted
  });

  it('TC-02: append does base durable write THEN adapter.index (base first); skips index on dedup', async () => {
    const base = createFakeBase({ deduplicated: false });
    const adapter = createFakeAdapter(async () => SEMANTIC_HIT);
    const store = createSemanticMemoryStore(base, adapter);
    const input = { topic: 'deploy', content: 'the deploy key rotates', id: 'c1' } as never;

    await store.append(input);
    expect(base.append).toHaveBeenCalledTimes(1);
    expect(adapter.index).toHaveBeenCalledWith(input);
    // base BEFORE index
    expect((base.append as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
      (adapter.index as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    );

    // dedup ⇒ index skipped (no duplicate vector)
    const dedupBase = createFakeBase({ deduplicated: true });
    const dedupAdapter = createFakeAdapter(async () => SEMANTIC_HIT);
    await createSemanticMemoryStore(dedupBase, dedupAdapter).append(input);
    expect(dedupBase.append).toHaveBeenCalledTimes(1);
    expect(dedupAdapter.index).not.toHaveBeenCalled();
  });

  it('TC-03: adapter-gating by composition — a plain base store (no decorator) never touches an adapter', async () => {
    const base = createFakeBase();
    const adapter = createFakeAdapter(async () => SEMANTIC_HIT);
    // Using the base directly (the surface simply did not compose the decorator) ⇒ keyword recall, no index.
    const input = { topic: 'x', content: 'y', id: 'c2' } as never;
    await base.append(input);
    await base.recall('q', BUDGET);
    expect(adapter.query).not.toHaveBeenCalled();
    expect(adapter.index).not.toHaveBeenCalled();
  });

  it('TC-04: recall query degradation — adapter.query throws ⇒ keyword base.recall, no throw', async () => {
    const base = createFakeBase();
    const adapter = createFakeAdapter(async () => {
      throw new Error('vector backend down');
    });
    const store = createSemanticMemoryStore(base, adapter);

    const result = await store.recall('q', BUDGET);
    expect(base.recall).toHaveBeenCalledWith('q', BUDGET);
    expect(result).toEqual(KEYWORD);
  });

  it('TC-05: index write degradation — adapter.index throws ⇒ base durable write kept, append does not throw', async () => {
    const base = createFakeBase({ deduplicated: false });
    const adapter = createFakeAdapter(
      async () => SEMANTIC_HIT,
      async () => {
        throw new Error('index failed');
      },
    );
    const store = createSemanticMemoryStore(base, adapter);
    const input = { topic: 'x', content: 'y', id: 'c3' } as never;

    const result = await expect(store.append(input)).resolves.toBeDefined();
    expect(base.append).toHaveBeenCalledTimes(1); // durable write still happened
    void result;
  });

  it('TC-06: capability-preservation/swap — a fake adapter upgrades recall, consumed transparently by AutomaticMemoryController', async () => {
    const base = createFakeBase();
    const adapter = createFakeAdapter(async () => SEMANTIC_HIT);
    const decorated = createSemanticMemoryStore(base, adapter);

    // The controller consumes IMemoryStore; injecting the decorated store needs NO controller/library change.
    const controller = new AutomaticMemoryController({
      cwd: '/tmp/does-not-matter',
      config: { policy: 'approval_required', retrieval: BUDGET },
      memoryStore: decorated,
    });

    const result = await controller.retrieve('paraphrased');
    expect(adapter.query).toHaveBeenCalledWith('paraphrased', BUDGET);
    expect(result.content).toBe('<semantic body>');
  });

  it('exposes the class + factory (public mechanism, mirrors createFileSystemMemoryStore)', () => {
    const store = createSemanticMemoryStore(
      createFakeBase(),
      createFakeAdapter(async () => SEMANTIC_HIT),
    );
    expect(store).toBeInstanceOf(SemanticMemoryStore);
  });
});
