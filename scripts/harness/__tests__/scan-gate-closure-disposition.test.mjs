import { describe, expect, it } from 'vitest';
import { CLOSED_UNDER } from '../scan-gate-closure-disposition.mjs';

describe('gate-closure-disposition', () => {
  it('accepts the exact tool-defect evidence form', () => {
    expect(
      CLOSED_UNDER.test(
        '**Closed under:** `tool-defect` — G1; gate `GATE-DONE`; defect record `scripts/harness/scan-gate-closure-disposition.mjs`; evidence `logs/gate.txt`',
      ),
    ).toBe(true);
  });

  it('rejects incomplete exception evidence', () => {
    expect(CLOSED_UNDER.test('**Closed under:** `tool-defect` — G1')).toBe(false);
  });
});
