import { describe, expect, it } from 'vitest';

import { CONTRACT_SHAPE, CONTRACT_SHAPE_V2 } from '../checkpoint-evidence-contract-shapes.mjs';

describe('checkpoint evidence contract declarations', () => {
  it('preserves v1 and declares mode-dependent v2 artifact multiplicity', () => {
    expect(CONTRACT_SHAPE.decisionArtifacts.multiplicity).toBe('exactly-one');
    expect(CONTRACT_SHAPE_V2.decisionArtifacts.multiplicityByDeliveryMode).toEqual({
      single: 'zero',
      sequenced: 'exactly-one',
    });
  });
});
