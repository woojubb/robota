import { describe, expect, it } from 'vitest';

import {
  collectBodyLines,
  examinedBodyLineCount,
  findMissingLines,
} from '../verify-doc-split-preservation.mjs';

/** 8 body lines: the four heading titles count, blank lines do not. */
const SOURCE = [
  '# Title',
  '',
  '## Alpha',
  '',
  'alpha body one',
  'alpha body two',
  '',
  '## Beta',
  '',
  'beta body one',
  '',
  '### Beta Detail',
  '',
  'shared line',
].join('\n');

function total(counts) {
  return [...counts.values()].reduce((sum, n) => sum + n, 0);
}

describe('examinedBodyLineCount — the declared examined size', () => {
  it('is exactly the body-line count of a fixture of known size', () => {
    expect(examinedBodyLineCount(SOURCE)).toBe(8);
  });

  it('is the same after a SECOND run of the finder — the counter does not accumulate', () => {
    const src = collectBodyLines(SOURCE);
    const only = collectBodyLines(['## Alpha', 'alpha body one'].join('\n'));
    findMissingLines(src, [only]);
    findMissingLines(src, [only]);
    collectBodyLines(SOURCE);
    collectBodyLines(SOURCE);
    expect(examinedBodyLineCount(SOURCE)).toBe(8);
  });

  it('counts nothing in an empty or blank-only document', () => {
    expect(examinedBodyLineCount('')).toBe(0);
    expect(examinedBodyLineCount('\n\n   \n')).toBe(0);
  });
});

describe('collectBodyLines', () => {
  it('agrees with the declared size on the same fixture', () => {
    expect(total(collectBodyLines(SOURCE))).toBe(8);
  });

  it('strips heading markers so a relocated section matches at any depth', () => {
    expect(collectBodyLines('## Alpha').has('Alpha')).toBe(true);
    expect(collectBodyLines('#### Alpha').has('Alpha')).toBe(true);
    expect(collectBodyLines('## Alpha').get('Alpha')).toBe(
      collectBodyLines('#### Alpha').get('Alpha'),
    );
  });

  it('does not strip a mid-line hash or a hash without a following space', () => {
    expect(collectBodyLines('#NoSpace').has('#NoSpace')).toBe(true);
    expect(collectBodyLines('see #123 for context').has('see #123 for context')).toBe(true);
  });

  it('counts a repeated line once per occurrence', () => {
    expect(collectBodyLines('dup\ndup\ndup').get('dup')).toBe(3);
  });
});

describe('findMissingLines', () => {
  it('reports nothing when the split preserves every line across two destinations', () => {
    const src = collectBodyLines(SOURCE);
    const specPart = collectBodyLines(
      ['# Title', '', '## Alpha', '', 'alpha body one', 'alpha body two'].join('\n'),
    );
    const designPart = collectBodyLines(
      ['# Beta', '', 'beta body one', '', '## Beta Detail', '', 'shared line'].join('\n'),
    );
    expect(findMissingLines(src, [specPart, designPart])).toEqual([]);
  });

  it('reports a dropped line exactly once with its shortfall', () => {
    const src = collectBodyLines(SOURCE);
    const only = collectBodyLines(['## Alpha', 'alpha body one', 'alpha body two'].join('\n'));
    const lost = findMissingLines(src, [only]).map(([line]) => line);
    expect(lost).toEqual(['Title', 'Beta', 'beta body one', 'Beta Detail', 'shared line']);
  });

  it('reports the shortfall, not the whole count, when a duplicate is partly preserved', () => {
    const src = collectBodyLines('dup\ndup\ndup');
    expect(findMissingLines(src, [collectBodyLines('dup')])).toEqual([['dup', 2]]);
  });

  it('is not fooled by a destination that merely contains extra lines', () => {
    const src = collectBodyLines('kept\nlost');
    const dest = collectBodyLines('kept\nunrelated one\nunrelated two');
    expect(findMissingLines(src, [dest])).toEqual([['lost', 1]]);
  });

  it('reports the same result on a second call — the counters do not accumulate', () => {
    const src = collectBodyLines(SOURCE);
    const only = collectBodyLines(['## Alpha', 'alpha body one', 'alpha body two'].join('\n'));
    const first = findMissingLines(src, [only]);
    const second = findMissingLines(src, [only]);
    expect(first.length).toBe(5);
    expect(second.length).toBe(5);
    expect(second).toEqual(first);
    // and the source counter itself is unchanged by having been read twice
    expect(total(src)).toBe(8);
  });
});
