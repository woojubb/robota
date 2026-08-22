import { mkdir, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  findBacklogPlacementFindings,
  findDuplicateIdFindings,
  readBacklogFrontmatter,
} from '../check-backlog-placement.mjs';

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

describe('a task file with no readable status', () => {
  /** One file, written verbatim, in whichever half of the tree the case is about. */
  async function treeWith(where, name, contents) {
    const dir = makeTemp('backlog-status-');
    await mkdir(path.join(dir, '.agents/tasks/completed'), { recursive: true });
    await writeFile(path.join(dir, '.agents/tasks', where, name), contents);
    return dir;
  }

  const NO_FRONTMATTER =
    '# ARCH-099\n\nstatus: done\n\nThe status is in the BODY, not a `---` block.\n';

  it('is REPORTED in the backlog root', async () => {
    const dir = await treeWith('.', 'ARCH-099-status-in-the-body.md', NO_FRONTMATTER);

    const findings = await findBacklogPlacementFindings(dir);

    expect(findings.map((f) => f.problem.slice(0, 24))).toEqual(['no `status:` in frontmat']);
  });

  it('is REPORTED in completed/ too', async () => {
    // The same defect, one loop down. `README.md` requires frontmatter of EVERY task file, and the
    // reason the root loop reports a missing one — that a status written in the body passes every
    // placement rule unread — does not stop applying because the file is archived. Review found the
    // fix applied to one loop and not its neighbour, which is how a class gets half-closed.
    const dir = await treeWith(
      'completed',
      'ARCH-098-archived-without-frontmatter.md',
      NO_FRONTMATTER,
    );

    const findings = await findBacklogPlacementFindings(dir);

    expect(findings.map((f) => f.problem.slice(0, 24))).toEqual(['no `status:` in frontmat']);
  });

  it('says nothing about a file that HAS one', async () => {
    const dir = await treeWith(
      'completed',
      'ARCH-097-archived.md',
      '---\nstatus: done\ncompleted: 2026-08-14\n---\n',
    );

    expect(await findBacklogPlacementFindings(dir)).toEqual([]);
  });
});

describe('findDuplicateIdFindings', () => {
  /** Build a throwaway backlog tree: { root: [names], completed: [names] }. */
  async function fixture(root, completed) {
    const dir = makeTemp('backlog-dup-');
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
    const dir = makeTemp('backlog-root-dup-');
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

describe('legacy terminal lifecycle baseline', () => {
  async function fixture({ mutate = false } = {}) {
    const root = makeTemp('backlog-lifecycle-baseline-');
    const completedDir = path.join(root, '.agents/tasks/completed');
    const baselineDir = path.join(root, 'scripts/harness');
    await mkdir(completedDir, { recursive: true });
    await mkdir(baselineDir, { recursive: true });
    const relative = '.agents/tasks/completed/OLD-001-task.md';
    await writeFile(
      path.join(root, relative),
      `---\nstatus: ${mutate ? 'rejected' : 'done'}\n---\n`,
    );
    const fingerprint = `${relative}|done|`;
    await writeFile(
      path.join(baselineDir, 'task-lifecycle-legacy-baseline.json'),
      JSON.stringify({
        count: 1,
        sha256: crypto.createHash('sha256').update(fingerprint).digest('hex'),
      }),
    );
    return root;
  }

  it('accepts only the exact frozen historical set', async () => {
    expect(await findBacklogPlacementFindings(await fixture())).toEqual([]);
  });

  it('rejects a substitution even when the violation count stays constant', async () => {
    const findings = await findBacklogPlacementFindings(await fixture({ mutate: true }));
    expect(findings.map((finding) => finding.problem).join('\n')).toMatch(
      /do not match.*baseline/i,
    );
  });

  it('rejects a stale nonzero baseline after the invalid set reaches zero', async () => {
    const root = await fixture();
    await writeFile(
      path.join(root, '.agents/tasks/completed/OLD-001-task.md'),
      '---\nstatus: done\ncompleted: 2026-08-14\n---\n',
    );
    const findings = await findBacklogPlacementFindings(root);
    expect(findings.map((finding) => finding.problem).join('\n')).toMatch(
      /0 archived.*do not match/i,
    );
  });
});
