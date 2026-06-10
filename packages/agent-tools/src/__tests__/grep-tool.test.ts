import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grepTool } from '../builtins/grep-tool.js';

interface IGrepResult {
  success: boolean;
  output: string;
  error?: string;
}

async function runGrep(args: Record<string, unknown>): Promise<IGrepResult> {
  const wrapper = await grepTool.execute(args as Parameters<typeof grepTool.execute>[0]);
  const data = (wrapper as { data: unknown }).data;
  return (typeof data === 'string' ? JSON.parse(data) : data) as IGrepResult;
}

describe('grepTool', () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'grep-tool-test-'));
    writeFileSync(join(fixtureDir, 'a.txt'), 'alpha\nbeta\nalpha beta\ngamma\n');
    writeFileSync(join(fixtureDir, 'b.txt'), 'alpha\ndelta\n');
    writeFileSync(join(fixtureDir, 'c.md'), 'alpha markdown\n');
    mkdirSync(join(fixtureDir, 'sub'));
    writeFileSync(join(fixtureDir, 'sub', 'd.txt'), 'no match here\n');
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('TC-01: count mode returns path:count rows for matching files only', async () => {
    const result = await runGrep({ pattern: 'alpha', path: fixtureDir, outputMode: 'count' });
    expect(result.success).toBe(true);
    const rows = result.output.split('\n').sort();
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.endsWith('a.txt:2'))).toBeDefined();
    expect(rows.find((r) => r.endsWith('b.txt:1'))).toBeDefined();
    expect(rows.find((r) => r.endsWith('c.md:1'))).toBeDefined();
  });

  it('TC-02: headLimit caps results and appends a truncation marker', async () => {
    const result = await runGrep({
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
    const result = await runGrep({
      pattern: 'alpha',
      path: fixtureDir,
      outputMode: 'files_with_matches',
    });
    expect(result.output.split('\n')).toHaveLength(3);
    expect(result.output).not.toContain('truncated');
  });

  it('TC-03: schema accepts count mode and headLimit; rejects non-positive headLimit', async () => {
    const ok = await runGrep({
      pattern: 'alpha',
      path: fixtureDir,
      outputMode: 'count',
      headLimit: 5,
    });
    expect(ok.success).toBe(true);
    await expect(runGrep({ pattern: 'alpha', path: fixtureDir, headLimit: 0 })).rejects.toThrow(
      /validation/i,
    );
  });

  it('TC-03: description mentions only schema-supported parameters', () => {
    const description = grepTool.schema.description ?? '';
    expect(description).toContain("'count'");
    expect(description).toContain('headLimit');
    expect(description).not.toContain('head_limit');
  });

  it('TC-04: files_with_matches returns matching file paths', async () => {
    const result = await runGrep({ pattern: 'delta', path: fixtureDir });
    expect(result.success).toBe(true);
    expect(result.output.trim().endsWith('b.txt')).toBe(true);
  });

  it('TC-04: content mode includes context lines with markers', async () => {
    const result = await runGrep({
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
    const result = await runGrep({ pattern: 'alpha', path: fixtureDir, glob: '*.md' });
    expect(result.output.split('\n')).toHaveLength(1);
    expect(result.output.trim().endsWith('c.md')).toBe(true);
  });

  it('returns an error result for an invalid regex', async () => {
    const result = await runGrep({ pattern: '([', path: fixtureDir });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid regex');
  });
});
