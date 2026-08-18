/**
 * INFRA-106 — a `#N` says whether it is an issue or a pull request.
 *
 * The RATCHET and the declared size. What a reference means is pinned in `reference-kind.test.mjs`,
 * beside the predicate both consumers read; this file is the tree-side half — which documents are in
 * scope, and the three directions the frozen counts may move in.
 */

import { describe, expect, it } from 'vitest';

import {
  collectReferences,
  compare,
  examinedDocumentCount,
} from '../scan-reference-kind-qualified.mjs';

describe('the ratchet', () => {
  it('passes a file at its frozen count', () => {
    expect(compare({ 'a.md': 3 }, { 'a.md': 3 }).ok).toBe(true);
  });

  it('fails a file whose count ROSE', () => {
    const verdict = compare({ 'a.md': 4 }, { 'a.md': 3 });
    expect(verdict.ok).toBe(false);
    expect(verdict.grew).toEqual([{ name: 'a.md', count: 4, frozen: 3 }]);
  });

  it('fails a file whose count FELL without being re-frozen', () => {
    // The gain has to be recorded in the same change, or it is a licence to grow back to the old
    // number without any run reporting a rise.
    const verdict = compare({ 'a.md': 1 }, { 'a.md': 3 });
    expect(verdict.ok).toBe(false);
    expect(verdict.shrunk).toEqual([{ name: 'a.md', count: 1, frozen: 3 }]);
  });

  it('fails a file the baseline does not know', () => {
    expect(compare({ 'new.md': 2 }, {}).unfrozen).toEqual([{ name: 'new.md', count: 2 }]);
  });

  it('does not fail a NEW file that carries none', () => {
    expect(compare({ 'new.md': 0 }, {}).ok).toBe(true);
  });

  it('fails a frozen row whose file left the tree', () => {
    // Otherwise the row sits in the baseline forever, excusing a count nobody measures any more.
    expect(compare({}, { 'gone.md': 3 }).missing).toEqual(['gone.md']);
  });

  it('reports every direction in one run, rather than stopping at the first', () => {
    const verdict = compare(
      { 'up.md': 2, 'down.md': 1, 'new.md': 1 },
      { 'up.md': 1, 'down.md': 3, 'gone.md': 1 },
    );
    expect(verdict.grew).toHaveLength(1);
    expect(verdict.shrunk).toHaveLength(1);
    expect(verdict.unfrozen).toHaveLength(1);
    expect(verdict.missing).toHaveLength(1);
  });
});

describe('the size it declares', () => {
  const FIXTURE = { 'a.md': 'see #1', 'b.md': 'see issue #2', 'c.md': 'nothing here' };
  const paths = Object.keys(FIXTURE);
  const read = (file) => FIXTURE[file];

  it('counts the documents it opened, and does not accumulate across runs', () => {
    collectReferences(paths, read);
    expect(examinedDocumentCount()).toBe(3);
    // The second run is the point: an accumulating counter passes the first assertion and reads 6
    // here, reporting a growing subject where the subject never changed.
    collectReferences(paths, read);
    expect(examinedDocumentCount()).toBe(3);
  });

  it('counts per file, including the files that carry none', () => {
    expect(collectReferences(paths, read).perFile).toEqual({ 'a.md': 1, 'b.md': 0, 'c.md': 0 });
  });
});

describe('what the first run corrected', () => {
  it('calls a count that fell to zero FELL, not MISSING', () => {
    // A file still in the tree whose count reached zero is a gain to re-freeze, not a deletion. The
    // first cut handed `compare` only the non-zero rows, so it reported "frozen, but no longer in
    // the tree" and sent the reader looking for a deletion that never happened.
    const verdict = compare({ 'a.md': 0 }, { 'a.md': 3 });
    expect(verdict.shrunk).toEqual([{ name: 'a.md', count: 0, frozen: 3 }]);
    expect(verdict.missing).toEqual([]);
  });
});
