import { describe, expect, it } from 'vitest';

import { readBacklogFrontmatter } from '../check-backlog-placement.mjs';

describe('readBacklogFrontmatter', () => {
  it('reads status and detects a completed date', () => {
    const fm = readBacklogFrontmatter('---\ntitle: x\nstatus: done\ncompleted: 2026-07-02\n---\n');
    expect(fm).toEqual({ status: 'done', hasCompletedDate: true });
  });

  it('reports a missing completed date', () => {
    expect(readBacklogFrontmatter('---\nstatus: done\n---\n').hasCompletedDate).toBe(false);
  });

  it('returns null status when frontmatter has none', () => {
    expect(readBacklogFrontmatter('# just prose').status).toBeNull();
  });
});
