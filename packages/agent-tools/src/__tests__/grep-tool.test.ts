import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGrepTool } from '../builtins/grep-tool.js';

interface IGrepResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * ARCH-010 — the containment root is a required constructor argument and the context-free `grepTool`
 * singleton is gone, so the tool is built per ROOT. This suite works in two independent tmpdirs, so it
 * takes two tools: binding both to one root (or to `process.cwd()`) would search outside the fixture
 * each case created.
 */
async function runGrep(root: string, args: Record<string, unknown>): Promise<IGrepResult> {
  const tool = createGrepTool({ cwd: root });
  const wrapper = await tool.execute(args as Parameters<typeof tool.execute>[0]);
  const data = (wrapper as { data: unknown }).data;
  return (typeof data === 'string' ? JSON.parse(data) : data) as IGrepResult;
}

describe('grepTool', () => {
  let fixtureDir: string;
  let bulkDir: string;

  beforeAll(() => {
    fixtureDir = realpathSync(mkdtempSync(join(tmpdir(), 'grep-tool-test-')));
    writeFileSync(join(fixtureDir, 'a.txt'), 'alpha\nbeta\nalpha beta\ngamma\n');
    writeFileSync(join(fixtureDir, 'b.txt'), 'alpha\ndelta\n');
    writeFileSync(join(fixtureDir, 'c.md'), 'alpha markdown\n');
    mkdirSync(join(fixtureDir, 'sub'));
    writeFileSync(join(fixtureDir, 'sub', 'd.txt'), 'no match here\n');

    // Deterministic multi-file corpus for ordering/determinism tests (CLI-042).
    // Separate tmpdir so it does not alter the counts the fixtureDir tests assert.
    bulkDir = realpathSync(mkdtempSync(join(tmpdir(), 'grep-tool-bulk-')));
    for (let i = 0; i < 80; i++) {
      const id = String(i).padStart(2, '0');
      writeFileSync(
        join(bulkDir, `bulk-${id}.txt`),
        `start ${id}\nalpha ${id}\nmiddle ${id}\nalpha again ${id}\nend ${id}\n`,
      );
    }
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(bulkDir, { recursive: true, force: true });
  });

  it('TC-01: count mode returns path:count rows for matching files only', async () => {
    const result = await runGrep(fixtureDir, {
      pattern: 'alpha',
      path: fixtureDir,
      outputMode: 'count',
    });
    expect(result.success).toBe(true);
    const rows = result.output.split('\n').sort();
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.endsWith('a.txt:2'))).toBeDefined();
    expect(rows.find((r) => r.endsWith('b.txt:1'))).toBeDefined();
    expect(rows.find((r) => r.endsWith('c.md:1'))).toBeDefined();
  });

  it('TC-02: headLimit caps results and appends a truncation marker', async () => {
    const result = await runGrep(fixtureDir, {
      pattern: 'alpha',
      path: fixtureDir,
      outputMode: 'files_with_matches',
      headLimit: 2,
    });
    expect(result.success).toBe(true);
    const lines = result.output.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('(+1 more results truncated by headLimit)');
  });

  it('TC-02: without headLimit all results are returned', async () => {
    const result = await runGrep(fixtureDir, {
      pattern: 'alpha',
      path: fixtureDir,
      outputMode: 'files_with_matches',
    });
    expect(result.output.split('\n')).toHaveLength(3);
    expect(result.output).not.toContain('truncated');
  });

  it('TC-03: schema accepts count mode and headLimit; rejects non-positive headLimit', async () => {
    const ok = await runGrep(fixtureDir, {
      pattern: 'alpha',
      path: fixtureDir,
      outputMode: 'count',
      headLimit: 5,
    });
    expect(ok.success).toBe(true);
    await expect(
      runGrep(fixtureDir, { pattern: 'alpha', path: fixtureDir, headLimit: 0 }),
    ).rejects.toThrow(/validation/i);
  });

  it('TC-03: description mentions only schema-supported parameters', () => {
    const description = createGrepTool({ cwd: fixtureDir }).schema.description ?? '';
    expect(description).toContain("'count'");
    expect(description).toContain('headLimit');
    expect(description).not.toContain('head_limit');
  });

  it('TC-04: files_with_matches returns matching file paths', async () => {
    const result = await runGrep(fixtureDir, { pattern: 'delta', path: fixtureDir });
    expect(result.success).toBe(true);
    expect(result.output.trim().endsWith('b.txt')).toBe(true);
  });

  it('TC-04: content mode includes context lines with markers', async () => {
    const result = await runGrep(fixtureDir, {
      pattern: 'beta',
      path: join(fixtureDir, 'a.txt'),
      outputMode: 'content',
      contextLines: 1,
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain(':2:beta');
    expect(result.output).toContain(':1-alpha');
  });

  it('TC-04: glob filter restricts searched files', async () => {
    const result = await runGrep(fixtureDir, { pattern: 'alpha', path: fixtureDir, glob: '*.md' });
    expect(result.output.split('\n')).toHaveLength(1);
    expect(result.output.trim().endsWith('c.md')).toBe(true);
  });

  it('TC-06: repeated runs over the same corpus produce byte-identical output (determinism)', async () => {
    for (const mode of ['files_with_matches', 'content', 'count'] as const) {
      const args: Record<string, unknown> = { pattern: 'alpha', path: bulkDir, outputMode: mode };
      if (mode === 'content') args.contextLines = 1;
      const first = await runGrep(bulkDir, args);
      const second = await runGrep(bulkDir, args);
      expect(first.success).toBe(true);
      expect(second.output).toBe(first.output);
    }
  });

  it('TC-06: directory output preserves per-file blocks in file-enumeration order', async () => {
    // The path result gives the actual enumeration order. Build an independent
    // expectation from the known fixture instead of starting another worker for
    // every file in each mode; the latter makes this test depend on CI load.
    const filesResult = await runGrep(bulkDir, { pattern: 'alpha', path: bulkDir });
    const fileOrder = filesResult.output.split('\n');
    expect(fileOrder).toHaveLength(80);

    for (const mode of ['content', 'count'] as const) {
      const dirArgs: Record<string, unknown> = {
        pattern: 'alpha',
        path: bulkDir,
        outputMode: mode,
      };
      if (mode === 'content') dirArgs.contextLines = 1;
      const dirResult = await runGrep(bulkDir, dirArgs);
      const expected = fileOrder
        .map((filePath) => {
          const id = basename(filePath, '.txt').slice('bulk-'.length);
          if (mode === 'count') return `${filePath}:2`;
          return [
            `${filePath}:1-start ${id}`,
            `${filePath}:2:alpha ${id}`,
            `${filePath}:3-middle ${id}`,
            `${filePath}:4:alpha again ${id}`,
            `${filePath}:5-end ${id}`,
          ].join('\n');
        })
        .join('\n');
      expect(dirResult.output).toBe(expected);
    }
  });

  it('returns an error result for an invalid regex', async () => {
    const result = await runGrep(fixtureDir, { pattern: '([', path: fixtureDir });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid regex');
  });

  it('refuses an oversized file before sending it to the matcher', async () => {
    const file = join(fixtureDir, 'oversized.txt');
    writeFileSync(file, 'x'.repeat(4 * 1024 * 1024 + 1));
    await expect(runGrep(fixtureDir, { pattern: 'x', path: file })).rejects.toThrow(
      'Grep search exceeded its byte limit',
    );
  });

  it('bounds content output amplified by matching line prefixes', async () => {
    const file = join(fixtureDir, 'many-lines.txt');
    writeFileSync(file, 'x\n'.repeat(100_000));
    await expect(
      runGrep(fixtureDir, { pattern: 'x', path: file, outputMode: 'content' }),
    ).rejects.toThrow('Grep search exceeded its byte limit');
  });
});
