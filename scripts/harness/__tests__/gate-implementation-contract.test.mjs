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
    expect(resolveContinuationGate({ correction: true }, 'GATE-IMPLEMENT', 'L2')).toMatchObject({
      priorKey: 'GATE-IMPLEMENT (correction)',
      upgrade: ['in-progress', 'in-progress (correction)'],
      correction: true,
    });
    expect(() =>
      resolveContinuationGate({ continuation: true, correction: true }, 'GATE-IMPLEMENT', 'L2'),
    ).toThrow(/mutually exclusive/);
    expect(rewriteFrontmatterStatus('---\nstatus: todo\n---\nbody\n', 'in-progress')).toContain(
      'status: in-progress',
    );
    expect(() => resolveContinuationGate({ continuation: true }, 'GATE-WRITE', 'L2')).toThrow(
      /only for L2 GATE-IMPLEMENT/,
    );
  });

  it('rewrites only a top-level status entry in the leading frontmatter block', () => {
    const source = '---\ntitle: status: prose\nstatus: todo\n---\nstatus: body\n';

    expect(rewriteFrontmatterStatus(source, 'in-progress')).toBe(
      '---\ntitle: status: prose\nstatus: in-progress\n---\nstatus: body\n',
    );
    expect(() => rewriteFrontmatterStatus('---\ntitle: task\n---\n', 'in-progress')).toThrow(
      /no status field/,
    );
    expect(() =>
      rewriteFrontmatterStatus('---\nstatus: todo\n---not-a-fence\nbody\n', 'in-progress'),
    ).toThrow(/no leading frontmatter block/);
  });
});
