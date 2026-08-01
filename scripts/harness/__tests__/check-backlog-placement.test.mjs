import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findDuplicateIdFindings, readBacklogFrontmatter } from '../check-backlog-placement.mjs';

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

describe('findDuplicateIdFindings', () => {
  /** Build a throwaway backlog tree: { root: [names], completed: [names] }. */
  async function fixture(root, completed) {
    const dir = await mkdtemp(path.join(tmpdir(), 'backlog-dup-'));
    await mkdir(path.join(dir, '.agents/tasks/completed'), { recursive: true });
    for (const name of root) {
      await writeFile(path.join(dir, '.agents/tasks', name), '---\nstatus: todo\n---\n');
    }
    for (const name of completed) {
      await writeFile(
        path.join(dir, '.agents/tasks/completed', name),
        '---\nstatus: done\ncompleted: 2026-07-25\n---\n',
      );
    }
    return dir;
  }

  it('flags the same ID filed in the root AND archived in completed/', async () => {
    const dir = await fixture(
      ['HARNESS-043-worktree-cwd-guard.md'],
      ['HARNESS-043-worktree-cwd-guard.md'],
    );
    const findings = await findDuplicateIdFindings(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0].problem).toContain('duplicate backlog ID HARNESS-043');
  });

  it('does NOT flag a phase follow-up filed while its parent is archived', async () => {
    const dir = await fixture(
      ['SELFHOST-008-P5-concrete-semantic-backend.md'],
      ['SELFHOST-008-durable-semantic-memory.md'],
    );
    expect(await findDuplicateIdFindings(dir)).toEqual([]);
  });

  it('passes when every ID lives in exactly one place', async () => {
    const dir = await fixture(
      ['ARCH-005-external-product-composition.md'],
      ['HARNESS-043-worktree-cwd-guard.md'],
    );
    expect(await findDuplicateIdFindings(dir)).toEqual([]);
  });
});

describe('findDuplicateIdFindings — same-ID collisions within the root', () => {
  async function rootOnly(names) {
    const dir = await mkdtemp(path.join(tmpdir(), 'backlog-root-dup-'));
    await mkdir(path.join(dir, '.agents/tasks/completed'), { recursive: true });
    for (const name of names) {
      await writeFile(path.join(dir, '.agents/tasks', name), '---\nstatus: todo\n---\n');
    }
    return dir;
  }

  it('flags one ID claimed by two different slugs (concurrent authors)', async () => {
    const dir = await rootOnly([
      'ARCH-006-framework-tool-axis-neutrality.md',
      'ARCH-006-route-robota-through-kernel-runtime-seam.md',
    ]);
    const findings = await findDuplicateIdFindings(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0].problem).toContain('one number, one item');
  });

  it('does NOT flag a phase follow-up beside its non-phase sibling', async () => {
    const dir = await rootOnly([
      'SELFHOST-011-P3-P4-evals-followups.md',
      'SELFHOST-011-evals-as-code.md',
    ]);
    expect(await findDuplicateIdFindings(dir)).toEqual([]);
  });
});
