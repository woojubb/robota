import { describe, expect, it } from 'vitest';

import {
  resolveContinuationGate,
  rewriteFrontmatterStatus,
} from '../gate-implementation-contract.mjs';

describe('gate implementation contract helpers', () => {
  it('resolves only the native L2 continuation and rewrites one frontmatter status', () => {
    expect(resolveContinuationGate({ continuation: true }, 'GATE-IMPLEMENT', 'L2')).toMatchObject({
      priorKey: 'GATE-IMPLEMENT (continuation)',
      upgrade: ['in-progress', 'in-progress (continuation)'],
    });
    expect(rewriteFrontmatterStatus('---\nstatus: todo\n---\nbody\n', 'in-progress')).toContain(
      'status: in-progress',
    );
    expect(() => resolveContinuationGate({ continuation: true }, 'GATE-WRITE', 'L2')).toThrow(
      /only for L2 GATE-IMPLEMENT/,
    );
  });
});
