import { describe, it, expect, vi } from 'vitest';

import { RepoMapRetrievalAdapter } from '../repo-map-adapter.js';
import {
  buildRepoMapIndex,
  updateRepoMapIndex,
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

  it('deserialize throws on a version-1 but structurally corrupt entry', () => {
    const corrupt = JSON.stringify({
      version: REPO_MAP_INDEX_VERSION,
      entries: [{ path: 'a.ts', definitions: 'not-an-array', references: [] }],
    });
    expect(() => deserializeRepoMapIndex(corrupt)).toThrow(/corrupt entry/);
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

describe('SELFHOST-003 P3 — incremental re-index (updateRepoMapIndex)', () => {
  // b.ts modified: `bar` now also references `foo`.
  const MODIFIED: Record<string, IRetrievalParsedFile> = {
    ...PARSED,
    'b.ts': {
      definitions: [{ file: 'b.ts', name: 'bar', kind: 'function', line: 1 }],
      references: ['foo'],
    },
  };

  it('re-parses ONLY the changed files and matches a full rebuild', async () => {
    const initial = buildRepoMapIndex({ parser: fakeParser(PARSED), corpus: CORPUS });
    const parse = vi.fn(fakeParser(MODIFIED).parse);

    const updated = updateRepoMapIndex(
      initial,
      { upserted: [{ path: 'b.ts', content: '' }] },
      { parse },
    );
    expect(parse).toHaveBeenCalledTimes(1); // only b.ts, not the whole corpus

    const rebuilt = buildRepoMapIndex({ parser: fakeParser(MODIFIED), corpus: CORPUS });
    const req = { activeFiles: ['a.ts'], tokenBudget: 1000 };
    expect(await new RepoMapRetrievalAdapter({ index: updated }).retrieve(req)).toEqual(
      await new RepoMapRetrievalAdapter({ index: rebuilt }).retrieve(req),
    );
  });

  it('drops removed paths and adds new files', () => {
    const initial = buildRepoMapIndex({ parser: fakeParser(PARSED), corpus: CORPUS });
    const parse = vi.fn(fakeParser({ 'd.ts': { definitions: [], references: [] } }).parse);

    const updated = updateRepoMapIndex(
      initial,
      { removed: ['b.ts'], upserted: [{ path: 'd.ts', content: '' }] },
      { parse },
    );
    const paths = updated.entries.map((e) => e.path).sort();
    expect(paths).toEqual(['a.ts', 'c.ts', 'd.ts']); // b.ts dropped, d.ts added
    expect(parse).toHaveBeenCalledTimes(1); // only the upserted d.ts
  });

  it('does not mutate the input index', () => {
    const initial = buildRepoMapIndex({ parser: fakeParser(PARSED), corpus: CORPUS });
    const before = JSON.stringify(initial);
    updateRepoMapIndex(initial, { removed: ['b.ts'] }, fakeParser(PARSED));
    expect(JSON.stringify(initial)).toBe(before);
  });

  it('de-duplicates a repeated upserted path (last-wins → one entry, matches a rebuild)', () => {
    const initial = buildRepoMapIndex({ parser: fakeParser(PARSED), corpus: CORPUS });
    const updated = updateRepoMapIndex(
      initial,
      {
        upserted: [
          { path: 'b.ts', content: 'stale' },
          { path: 'b.ts', content: 'latest' },
        ],
      },
      fakeParser(MODIFIED),
    );
    expect(updated.entries.filter((e) => e.path === 'b.ts')).toHaveLength(1);
  });

  it('upsert wins when a path is both removed and upserted', () => {
    const initial = buildRepoMapIndex({ parser: fakeParser(PARSED), corpus: CORPUS });
    const updated = updateRepoMapIndex(
      initial,
      { removed: ['b.ts'], upserted: [{ path: 'b.ts', content: '' }] },
      fakeParser(MODIFIED),
    );
    expect(updated.entries.find((e) => e.path === 'b.ts')?.references).toEqual(['foo']);
  });
});
