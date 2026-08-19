/**
 * INFRA-121 (issue #1908) — the enumeration a scan judges.
 *
 * The case that carries the weight is the untracked one, because that is the false green this module
 * exists to remove: a file written and not yet staged was invisible to eight scans, at exactly the
 * moment its author was checking their own work.
 */

import { describe, expect, it } from 'vitest';

import { collectFiles, enumerateFiles, examinedFileCount } from '../enumerate-files.mjs';

/** A `run` seam that answers each ls-files invocation from a fixture. */
function gitDouble({ tracked = [], untracked = [] }) {
  return (args) => (args.includes('--others') ? untracked : tracked);
}

describe('what a scan enumerates', () => {
  it('includes a file written and not yet staged', () => {
    const files = enumerateFiles([], {
      run: gitDouble({ tracked: ['a.md'], untracked: ['brand-new.md'] }),
    });
    expect(files).toContain('brand-new.md');
  });

  it('is exactly what the OLD behaviour missed', () => {
    // The measured incident: passed before `git add`, failed after, while printing a size and a pass.
    const run = gitDouble({ tracked: ['a.md'], untracked: ['brand-new.md'] });
    expect(enumerateFiles([], { run, includeUntracked: false })).not.toContain('brand-new.md');
    expect(enumerateFiles([], { run })).toContain('brand-new.md');
  });

  it('does not double-count a path git reports twice', () => {
    const files = enumerateFiles([], {
      run: gitDouble({ tracked: ['a.md', 'b.md'], untracked: ['b.md'] }),
    });
    expect(files).toEqual(['a.md', 'b.md']);
  });

  it('returns a stable order, so a finding list does not churn between runs', () => {
    const files = enumerateFiles([], {
      run: gitDouble({ tracked: ['z.md', 'a.md'], untracked: ['m.md'] }),
    });
    expect(files).toEqual(['a.md', 'm.md', 'z.md']);
  });
});

describe('the size it reports', () => {
  const run = gitDouble({ tracked: ['a.md', 'b.md'], untracked: ['c.md'] });

  it('counts exactly what it returned', () => {
    collectFiles([], { run });
    expect(examinedFileCount()).toBe(3);
  });

  it('reports the same count after a SECOND run, rather than accumulating', () => {
    // An accumulating counter and a growing subject produce the same rising number. Running the
    // enumerator twice over one fixture is what tells them apart: only the accumulator changes.
    collectFiles([], { run });
    collectFiles([], { run });
    expect(examinedFileCount()).toBe(3);
  });
});
