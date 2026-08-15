import { describe, expect, it } from 'vitest';

import {
  collectAllowanceFindings,
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

describe('collectAllowanceFindings — the guard on the escape hatch', () => {
  const dest = collectBodyLines(
    ['## Architecture Overview', 'see ../../agent-framework/docs/SPEC.md for the owner'].join('\n'),
  );

  it('excuses a rename whose named survivor is really present', () => {
    const { excused, findings } = collectAllowanceFindings(
      [{ lost: 'Architecture', survivesAs: 'Architecture Overview', reason: 'renamed' }],
      [dest],
    );
    expect(findings).toEqual([]);
    expect([...excused]).toEqual(['Architecture']);
  });

  it('refuses a rename whose named survivor is in no destination — and excuses nothing', () => {
    const { excused, findings } = collectAllowanceFindings(
      [{ lost: 'Architecture', survivesAs: 'Nowhere At All', reason: 'renamed' }],
      [dest],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('is in no destination');
    expect(excused.size).toBe(0);
  });

  it('excuses a delete-and-link only when a destination really links to the owner', () => {
    const good = collectAllowanceFindings(
      [
        {
          lost: 'a paraphrase of the owner',
          deletedAndLinkedTo: 'packages/agent-framework/docs/SPEC.md',
          reason: 'owned elsewhere',
        },
      ],
      [dest],
    );
    expect(good.findings).toEqual([]);
    expect(good.excused.size).toBe(1);

    const bad = collectAllowanceFindings(
      [
        {
          lost: 'a paraphrase of the owner',
          deletedAndLinkedTo: 'packages/agent-session/docs/SPEC.md',
          reason: 'owned elsewhere',
        },
      ],
      [dest],
    );
    expect(bad.findings).toHaveLength(1);
    expect(bad.findings[0]).toContain('no destination links there');
    expect(bad.excused.size).toBe(0);
  });

  it('refuses an allowance with no written reason — an unexplained allowance is a deletion', () => {
    const { excused, findings } = collectAllowanceFindings([{ lost: 'Architecture' }], [dest]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('no "reason"');
    expect(excused.size).toBe(0);
  });

  it('refuses an entry claiming both a rename and a delete-and-link', () => {
    const { findings } = collectAllowanceFindings(
      [
        {
          lost: 'Architecture',
          survivesAs: 'Architecture Overview',
          deletedAndLinkedTo: 'packages/agent-framework/docs/SPEC.md',
          reason: 'both',
        },
      ],
      [dest],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('can only be one');
  });

  it('excuses an entry that names neither, on its written reason alone', () => {
    const { excused, findings } = collectAllowanceFindings(
      [{ lost: 'a re-wrapped sentence', reason: 'line breaks moved; the words survive' }],
      [dest],
    );
    expect(findings).toEqual([]);
    expect(excused.size).toBe(1);
  });

  it('reports a malformed entry rather than skipping it silently', () => {
    const { findings } = collectAllowanceFindings([{ reason: 'no lost line' }, null], [dest]);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.includes('no "lost" line'))).toBe(true);
  });

  it('excuses nothing when given no allowances', () => {
    const { excused, findings } = collectAllowanceFindings([], [dest]);
    expect(excused.size).toBe(0);
    expect(findings).toEqual([]);
  });
});
