/**
 * Tests for GrepTool
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { grepTool } from '@robota-sdk/agent-tools';
import type { TToolResult } from '@robota-sdk/agent-tools';
import type { TToolParameters } from '@robota-sdk/agent-core';

async function run(params: TToolParameters): Promise<TToolResult> {
  const rawResult = await grepTool.execute(params);
  return JSON.parse(rawResult.data as string) as TToolResult;
}

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'grep-tool-test-'));

  // Structure:
  // tmpDir/
  //   alpha.ts   — contains "function hello() {}"
  //   beta.ts    — contains "const world = 42;"
  //   sub/
  //     gamma.ts — contains "hello world"
  //   node_modules/
  //     excluded.ts — contains "hello"

  await writeFile(join(tmpDir, 'alpha.ts'), 'function hello() {}\nconst x = 1;\n');
  await writeFile(join(tmpDir, 'beta.ts'), 'const world = 42;\nconst y = 2;\n');
  await mkdir(join(tmpDir, 'sub'));
  await writeFile(join(tmpDir, 'sub', 'gamma.ts'), 'hello world\nfoo bar\n');
  await mkdir(join(tmpDir, 'node_modules'));
  await writeFile(join(tmpDir, 'node_modules', 'excluded.ts'), 'hello inside node_modules\n');
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('GrepTool', () => {
  it('returns files containing the pattern (files_with_matches mode)', async () => {
    const result = await run({ pattern: 'hello', path: tmpDir });
    expect(result.success).toBe(true);

    const lines = result.output.split('\n');
    expect(lines.some((l) => l.includes('alpha.ts'))).toBe(true);
    expect(lines.some((l) => l.includes('gamma.ts'))).toBe(true);
    // beta.ts does not contain "hello"
    expect(lines.some((l) => l.includes('beta.ts'))).toBe(false);
  });

  it('excludes node_modules', async () => {
    const result = await run({ pattern: 'hello', path: tmpDir });
    expect(result.success).toBe(true);
    expect(result.output).not.toContain('node_modules');
  });

  it('returns (no matches) when pattern has no hits', async () => {
    const result = await run({ pattern: 'zzz_no_match_zzz', path: tmpDir });
    expect(result.success).toBe(true);
    expect(result.output).toBe('(no matches)');
  });

  it('content mode returns matching lines', async () => {
    const result = await run({ pattern: 'hello', path: tmpDir, outputMode: 'content' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
    // Should contain line number + colon format
    expect(result.output).toMatch(/:\d+:/);
  });

  it('content mode includes context lines', async () => {
    const result = await run({
      pattern: 'function hello',
      path: join(tmpDir, 'alpha.ts'),
      outputMode: 'content',
      contextLines: 1,
    });
    expect(result.success).toBe(true);
    // Should include the line after "function hello"
    expect(result.output).toContain('const x = 1');
  });

  it('glob filter restricts searched files', async () => {
    // Only search .ts files
    const result = await run({ pattern: 'hello', path: tmpDir, glob: '*.ts' });
    expect(result.success).toBe(true);
    // Should still find matches
    expect(result.output).not.toBe('(no matches)');
  });

  it('supports regex patterns', async () => {
    const result = await run({ pattern: 'const \\w+ = \\d+', path: tmpDir });
    expect(result.success).toBe(true);
    // beta.ts has "const world = 42"
    expect(result.output).toContain('beta.ts');
  });

  it('returns error for invalid regex', async () => {
    const result = await run({ pattern: '[invalid', path: tmpDir });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid regex');
  });

  it('returns error for non-existent path', async () => {
    const result = await run({ pattern: 'hello', path: join(tmpDir, 'nonexistent') });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('searches a single file when path points to a file', async () => {
    const result = await run({ pattern: 'world', path: join(tmpDir, 'beta.ts') });
    expect(result.success).toBe(true);
    expect(result.output).toContain('beta.ts');
  });
});
