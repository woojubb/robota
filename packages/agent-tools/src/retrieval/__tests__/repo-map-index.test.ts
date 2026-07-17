import { describe, it, expect, vi } from 'vitest';

import { RepoMapRetrievalAdapter } from '../repo-map-adapter.js';
import {
  buildRepoMapIndex,
  serializeRepoMapIndex,
  deserializeRepoMapIndex,
  REPO_MAP_INDEX_VERSION,
} from '../repo-map-index.js';

import type {
  IRetrievalCorpusFile,
  IRetrievalParsedFile,
  IRetrievalSourceParser,
} from '../types.js';

function fakeParser(byFile: Record<string, IRetrievalParsedFile>): IRetrievalSourceParser {
  return { parse: (file) => byFile[file] ?? { definitions: [], references: [] } };
}

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

describe('SELFHOST-003 P2 — repo-map index build + persistence', () => {
  it('buildRepoMapIndex parses the corpus once into a versioned index', () => {
    const parse = vi.fn(fakeParser(PARSED).parse);
    const index = buildRepoMapIndex({ parser: { parse }, corpus: CORPUS });

    expect(index.version).toBe(REPO_MAP_INDEX_VERSION);
    expect(index.entries.map((e) => e.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(index.entries[0]).toEqual({
      path: 'a.ts',
      definitions: [{ file: 'a.ts', name: 'foo', kind: 'function', line: 1 }],
      references: ['bar', 'baz'],
    });
    expect(parse).toHaveBeenCalledTimes(CORPUS.length);
  });

  it('serialize → deserialize round-trips the index exactly', () => {
    const index = buildRepoMapIndex({ parser: fakeParser(PARSED), corpus: CORPUS });
    const restored = deserializeRepoMapIndex(serializeRepoMapIndex(index));
    expect(restored).toEqual(index);
  });

  it('deserialize throws on an unsupported version (stale index must be rebuilt)', () => {
    const stale = JSON.stringify({ version: REPO_MAP_INDEX_VERSION + 1, entries: [] });
    expect(() => deserializeRepoMapIndex(stale)).toThrow(/Unsupported repo-map index version/);
  });

  it('ranking is identical whether built from a corpus or from a persisted index', async () => {
    const fromCorpus = new RepoMapRetrievalAdapter({ parser: fakeParser(PARSED), corpus: CORPUS });

    const persisted = serializeRepoMapIndex(
      buildRepoMapIndex({ parser: fakeParser(PARSED), corpus: CORPUS }),
    );
    const fromIndex = new RepoMapRetrievalAdapter({ index: deserializeRepoMapIndex(persisted) });

    const req = { activeFiles: ['a.ts'], tokenBudget: 1000 };
    expect(await fromIndex.retrieve(req)).toEqual(await fromCorpus.retrieve(req));
  });

  it('parses the corpus ONCE (at construction), not on every retrieve()', async () => {
    const parse = vi.fn(fakeParser(PARSED).parse);
    const adapter = new RepoMapRetrievalAdapter({ parser: { parse }, corpus: CORPUS });

    await adapter.retrieve({ tokenBudget: 1000 });
    await adapter.retrieve({ activeFiles: ['a.ts'], tokenBudget: 1000 });
    await adapter.retrieve({ mentionedIdentifiers: ['foo'], tokenBudget: 1000 });

    expect(parse).toHaveBeenCalledTimes(CORPUS.length); // once per file total, not per retrieve
  });

  it('throws when constructed with neither an index nor a parser+corpus', () => {
    expect(() => new RepoMapRetrievalAdapter({})).toThrow(/requires either/);
  });
});
