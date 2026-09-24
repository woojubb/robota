import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectGlobMatches, globFileTool } from '../builtins/glob-tool.js';

/**
 * Issue #2875 (CPU/IO budget): the old `globFileTool` called `fg(pattern)` — the promise form —
 * which materializes EVERY match into an array before stating any of them, then only slices to
 * `limit` at the very end. A pattern like `**\/*` under a huge tree allocated and statted the whole
 * match set no matter how small `limit` was. `collectGlobMatches` streams matches instead and stops
 * at `maxCandidates`; these tests drive it with a small override (the real default,
 * `DEFAULT_MAX_GLOB_CANDIDATES`, is too large to exercise cheaply) and assert the CANDIDATE COLLECTION
 * itself — not a post-hoc slice — stops at the ceiling.
 */
describe('collectGlobMatches bounds candidate enumeration', () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'glob-bounded-collection-')));
    for (let i = 0; i < 25; i++) {
      writeFileSync(join(root, `file-${String(i).padStart(2, '0')}.txt`), 'x');
    }
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('stops streaming matches at the ceiling instead of collecting them all', async () => {
    const ceiling = 10;
    const { matches, truncated } = await collectGlobMatches(
      '*.txt',
      { cwd: root, dot: true, absolute: false },
      ceiling,
    );

    expect(matches.length).toBeLessThanOrEqual(ceiling);
    expect(truncated).toBe(true);
  });

  it('reports every match when the tree is within the ceiling', async () => {
    const { matches, truncated } = await collectGlobMatches(
      '*.txt',
      { cwd: root, dot: true, absolute: false },
      1000,
    );
    expect(matches.length).toBe(25);
    expect(truncated).toBe(false);
  });
});

describe('Glob tool surfaces candidate truncation', () => {
  it('states truncation explicitly when candidate enumeration was cut short', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'glob-bounded-tool-')));
    try {
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(root, `f-${i}.txt`), 'x');
      }
      // Exercises the actual function `createGlobTool` wires up (globFileTool), called directly with
      // a tiny `maxCandidates` — the real default is too large to exercise cheaply here, and this
      // parameter is not part of the public tool schema (see globFileTool's doc comment).
      const raw = await globFileTool({ pattern: '*.txt' }, { cwd: root }, 2);
      const parsed = JSON.parse(raw) as { success: boolean; output: string };

      expect(parsed.success).toBe(true);
      expect(parsed.output).toContain('Candidate search stopped early');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not mention truncation when every candidate was collected', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'glob-bounded-tool-full-')));
    try {
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(root, `f-${i}.txt`), 'x');
      }
      const raw = await globFileTool({ pattern: '*.txt' }, { cwd: root }, 1000);
      const parsed = JSON.parse(raw) as { success: boolean; output: string };

      expect(parsed.success).toBe(true);
      expect(parsed.output).not.toContain('Candidate search stopped early');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
