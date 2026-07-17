import { describe, it, expect } from 'vitest';

import { RepoMapRetrievalAdapter } from '../repo-map-adapter.js';
import { createRetrievalTool } from '../retrieval-tool.js';

import type {
  IRetrievalAdapter,
  IRetrievalCorpusFile,
  IRetrievalParsedFile,
  IRetrievalSourceParser,
} from '../types.js';

/** A fake parser driven by a per-file lookup — stands in for the injected (heavy) source parser. */
function fakeParser(byFile: Record<string, IRetrievalParsedFile>): IRetrievalSourceParser {
  return { parse: (file) => byFile[file] ?? { definitions: [], references: [] } };
}

// Fixture: a.ts defines foo + references bar/baz; b.ts defines bar; c.ts defines baz + references bar.
// So bar is referenced by a + c (central), baz by a, foo by nobody.
const PARSED: Record<string, IRetrievalParsedFile> = {
  'a.ts': {
    definitions: [{ file: 'a.ts', name: 'foo', kind: 'function', line: 1 }],
    references: ['bar', 'baz'],
  },
  'b.ts': {
    definitions: [{ file: 'b.ts', name: 'bar', kind: 'function', line: 1 }],
    references: [],
  },
  'c.ts': {
    definitions: [{ file: 'c.ts', name: 'baz', kind: 'function', line: 1 }],
    references: ['bar'],
  },
};
const CORPUS: IRetrievalCorpusFile[] = [
  { path: 'a.ts', content: '' },
  { path: 'b.ts', content: '' },
  { path: 'c.ts', content: '' },
];

function makeAdapter(): RepoMapRetrievalAdapter {
  return new RepoMapRetrievalAdapter({ parser: fakeParser(PARSED), corpus: CORPUS });
}

describe('SELFHOST-003 P1 — RepoMapRetrievalAdapter', () => {
  // TC-02: repo-map ranking for a given active-file set.
  it('TC-02: ranks the most central symbols; active files personalize the ranking', async () => {
    const adapter = makeAdapter();

    const plain = await adapter.retrieve({ tokenBudget: 1000 });
    expect(plain.symbols.map((s) => s.name)).toEqual(['bar', 'baz', 'foo']); // bar(2) > baz(1) > foo(0)

    const focused = await adapter.retrieve({ activeFiles: ['a.ts'], tokenBudget: 1000 });
    expect(focused.symbols[0].name).toBe('bar'); // a.ts refs weighted ×3 → bar(4) > baz(3) > foo(0)
    const barScore = focused.symbols.find((s) => s.name === 'bar')?.score ?? 0;
    const bazScore = focused.symbols.find((s) => s.name === 'baz')?.score ?? 0;
    expect(barScore).toBeGreaterThan(bazScore);
  });

  it('boosts a directly-mentioned identifier above its reference-only centrality', async () => {
    const adapter = makeAdapter();
    // `foo` has zero references (centrality 0) but a direct mention (+MENTION_BOOST) must lift it
    // above `baz` (reference centrality 1) — exercising the mentionedIdentifiers ranking branch.
    const result = await adapter.retrieve({ mentionedIdentifiers: ['foo'], tokenBudget: 1000 });
    const fooScore = result.symbols.find((s) => s.name === 'foo')?.score ?? 0;
    const bazScore = result.symbols.find((s) => s.name === 'baz')?.score ?? 0;
    expect(fooScore).toBeGreaterThan(bazScore);
    expect(result.symbols[0].name).toBe('foo');
  });

  // TC-01: the contract returns ranked results and never exceeds the token budget.
  it('TC-01: truncates to the token budget most-relevant-first, never exceeding it', async () => {
    const adapter = makeAdapter();

    const full = await adapter.retrieve({ tokenBudget: 1000 });
    expect(full.symbols).toHaveLength(3);
    const perEntry = full.symbols[0].tokens; // each fixture entry costs the same (5 tokens)

    const tight = await adapter.retrieve({ tokenBudget: perEntry });
    expect(tight.symbols).toHaveLength(1);
    expect(tight.symbols[0].name).toBe('bar'); // the top-ranked entry
    expect(tight.totalTokens).toBeLessThanOrEqual(perEntry);

    const none = await adapter.retrieve({ tokenBudget: 0 });
    expect(none.symbols).toHaveLength(0);
    expect(none.totalTokens).toBe(0);
  });

  it('carries no corpus itself — the corpus is supplied at construction (neutrality)', async () => {
    const empty = new RepoMapRetrievalAdapter({ parser: fakeParser(PARSED), corpus: [] });
    const result = await empty.retrieve({ tokenBudget: 1000 });
    expect(result.symbols).toHaveLength(0);
  });
});

describe('SELFHOST-003 P1 — createRetrievalTool', () => {
  // TC-05: swapping the adapter needs no agent-tools change — a fake adapter drives the tool.
  it('TC-05: works with any IRetrievalAdapter (fake adapter, not the repo-map one)', async () => {
    const fake: IRetrievalAdapter = {
      retrieve: async () => ({
        symbols: [{ file: 'x.ts', name: 'widget', kind: 'class', line: 42, score: 9, tokens: 4 }],
        totalTokens: 4,
      }),
    };
    const tool = createRetrievalTool({ adapter: fake });
    const result = await tool.execute(
      { activeFiles: ['x.ts'], tokenBudget: 100 },
      { toolName: 'CodebaseRetrieval', parameters: { tokenBudget: 100 } },
    );
    const output = String(result.data);
    expect(output).toContain('x.ts:42');
    expect(output).toContain('class widget');
  });

  it('reports unavailability when no adapter is supplied (adapter-gated)', async () => {
    const tool = createRetrievalTool();
    const result = await tool.execute(
      { tokenBudget: 100 },
      { toolName: 'CodebaseRetrieval', parameters: { tokenBudget: 100 } },
    );
    expect(String(result.data)).toContain('not available');
  });
});
