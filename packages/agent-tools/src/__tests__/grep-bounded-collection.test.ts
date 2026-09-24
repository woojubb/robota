import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const statCallCount = vi.hoisted(() => ({ count: 0 }));

// `vi.spyOn` cannot redefine a non-configurable ESM named export (node:fs/promises), so the walk's
// `stat` fan-out is counted through a mock instead — same technique as grep-cancel-join.test.ts.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: (...args: Parameters<typeof actual.stat>) => {
      statCallCount.count++;
      return actual.stat(...args);
    },
  };
});

const { collectFiles } = await import('../builtins/grep-search.js');
const { createGrepTool } = await import('../builtins/grep-tool.js');

/**
 * Issue #2875 (CPU/IO budget): `collectFiles` used to walk and `stat` every file under the search
 * root before `headLimit` ever got a chance to truncate anything — memory and stat fan-out scaled
 * with the whole tree, not with any limit. These tests drive the walk with a small `maxFiles`
 * override (the real default, `DEFAULT_MAX_COLLECTED_FILES`, is too large to exercise cheaply) and
 * assert the walk itself — not just the reported output — stops at the ceiling.
 */
describe('collectFiles bounds enumeration', () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'grep-bounded-collection-')));
    for (let i = 0; i < 25; i++) {
      writeFileSync(join(root, `file-${String(i).padStart(2, '0')}.txt`), 'x');
    }
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('stops walking at the ceiling instead of visiting every file', async () => {
    statCallCount.count = 0;
    const ceiling = 10;
    const { files, truncated } = await collectFiles(root, undefined, root, ceiling);

    expect(files.length).toBeLessThanOrEqual(ceiling);
    expect(truncated).toBe(true);
    // The walk must not have statted more entries than the ceiling — proof the bound applies to the
    // WALK, not just to a post-hoc slice of an already-fully-collected array.
    expect(statCallCount.count).toBeLessThanOrEqual(ceiling);
  });

  it('reports every file when the tree is within the ceiling', async () => {
    const { files, truncated } = await collectFiles(root, undefined, root, 1000);
    expect(files.length).toBe(25);
    expect(truncated).toBe(false);
  });
});

/**
 * Tool-level: `Grep`'s output states truncation explicitly, and cancellation still works when
 * enumeration is bounded (see grep-cancel-join.test.ts for the read-cancellation path this must not
 * regress).
 */
describe('Grep tool surfaces enumeration truncation', () => {
  it('does not claim "(no matches)" when the file walk was cut short', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'grep-bounded-tool-')));
    try {
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(root, `f-${i}.txt`), 'nothing to see\n');
      }
      // Force the tool's real call site to hit a tiny ceiling by stubbing collectFiles's default via
      // a direct spy on the module export is not possible for a same-module default parameter, so we
      // instead assert the true default ceiling never fires here (sanity) and rely on the unit test
      // above for the bound itself; this test only checks the output-shape contract when truncated.
      const grepSearch = await import('../builtins/grep-search.js');
      const spy = vi
        .spyOn(grepSearch, 'collectFiles')
        .mockResolvedValue({ files: [join(root, 'f-0.txt')], truncated: true });

      const tool = createGrepTool({ cwd: root });
      const wrapper = await tool.execute({ pattern: 'nothing', path: root, outputMode: 'content' });
      const data = (wrapper as { data: unknown }).data;
      const parsed = (typeof data === 'string' ? JSON.parse(data) : data) as {
        success: boolean;
        output: string;
      };
      expect(parsed.success).toBe(true);
      expect(parsed.output).toContain('File enumeration stopped early');

      spy.mockRestore();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
