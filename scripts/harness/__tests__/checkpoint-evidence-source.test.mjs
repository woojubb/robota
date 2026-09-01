import { describe, expect, it } from 'vitest';

import {
  priorPassDigest,
  rawGateImplementPassEntries,
  taskItemsForCheckpoint,
} from '../checkpoint-evidence-source.mjs';

describe('checkpoint evidence source helpers', () => {
  it('selects Task items and gives separator-stable raw PASS identity', () => {
    expect(
      taskItemsForCheckpoint(
        '## Completion Criteria\n\n- [ ] TC-01: observable result\n',
        'TC-01 is planned',
      ),
    ).toMatchObject({ ok: true, items: [{ kind: 'tc-id', value: 'TC-01' }] });
    const parent =
      '## Evidence Log\n\n### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-01\n\n**Status upgrade:** approved → in-progress\n\nraw  \n\n';
    const continued = `${parent}\n### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-02\n\nnext\n`;
    const before = rawGateImplementPassEntries(parent)[0];
    const after = rawGateImplementPassEntries(continued)[0];
    expect(after).toBe(before);
    expect(priorPassDigest(after)).toBe(priorPassDigest(before));
  });
});
