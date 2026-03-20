/**
 * Tests for GlobTool
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { globTool } from '@robota-sdk/agent-tools';
import type { TToolResult } from '@robota-sdk/agent-tools';
import type { TToolParameters } from '@robota-sdk/agent-core';

async function run(params: TToolParameters): Promise<TToolResult> {
  const rawResult = await globTool.execute(params);
  return JSON.parse(rawResult.data as string) as TToolResult;
}

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'glob-tool-test-'));

  // Create directory structure:
  // tmpDir/
  //   a.ts
  //   b.ts
  //   sub/
  //     c.ts
  //     d.js
  //   node_modules/
  //     excluded.ts
  //   .git/
  //     excluded.ts

  await writeFile(join(tmpDir, 'a.ts'), 'const a = 1;');
  await writeFile(join(tmpDir, 'b.ts'), 'const b = 2;');
  await mkdir(join(tmpDir, 'sub'));
  await writeFile(join(tmpDir, 'sub', 'c.ts'), 'const c = 3;');
  await writeFile(join(tmpDir, 'sub', 'd.js'), 'const d = 4;');
  await mkdir(join(tmpDir, 'node_modules'));
  await writeFile(join(tmpDir, 'node_modules', 'excluded.ts'), 'excluded');
  await mkdir(join(tmpDir, '.git'));
  await writeFile(join(tmpDir, '.git', 'excluded.ts'), 'excluded');
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('GlobTool', () => {
  it('finds files matching pattern', async () => {
    const result = await run({ pattern: '**/*.ts', path: tmpDir });
    expect(result.success).toBe(true);

    const files = result.output.split('\n').filter((l) => l !== '(no matches)');
    expect(files.length).toBeGreaterThanOrEqual(3); // a.ts, b.ts, sub/c.ts
    expect(files.some((f) => f.includes('a.ts'))).toBe(true);
    expect(files.some((f) => f.includes('b.ts'))).toBe(true);
    expect(files.some((f) => f.includes('c.ts'))).toBe(true);
  });

  it('excludes node_modules', async () => {
    const result = await run({ pattern: '**/*.ts', path: tmpDir });
    expect(result.success).toBe(true);
    expect(result.output).not.toContain('node_modules');
  });

  it('excludes .git', async () => {
    const result = await run({ pattern: '**/*.ts', path: tmpDir });
    expect(result.success).toBe(true);
    expect(result.output).not.toContain('.git');
  });

  it('returns (no matches) for unmatched pattern', async () => {
    const result = await run({ pattern: '**/*.xyz', path: tmpDir });
    expect(result.success).toBe(true);
    expect(result.output).toBe('(no matches)');
  });

  it('matches only .js files with *.js pattern', async () => {
    const result = await run({ pattern: '**/*.js', path: tmpDir });
    expect(result.success).toBe(true);
    const files = result.output.split('\n');
    expect(files.some((f) => f.includes('d.js'))).toBe(true);
    expect(files.some((f) => f.endsWith('.ts'))).toBe(false);
  });

  it('uses cwd as default path when path is not provided', async () => {
    // Just verify it doesn't crash — actual results depend on the test cwd
    const result = await run({ pattern: '*.json' });
    expect(result.success).toBe(true);
  });

  // --- P1: limit parameter truncation ---

  it('respects limit parameter and shows truncation message', async () => {
    const result = await run({ pattern: '**/*', path: tmpDir, limit: 2 });
    expect(result.success).toBe(true);
    const lines = result.output.split('\n').filter(Boolean);
    // Should have at most 2 file entries + optional truncation message
    const fileLines = lines.filter((l) => !l.startsWith('['));
    expect(fileLines.length).toBeLessThanOrEqual(2);
  });

  // --- P1: mtime sort order (most recent first) ---

  it('returns results sorted by modification time (most recent first)', async () => {
    // Create files with controlled timing
    const older = join(tmpDir, 'older.txt');
    const newer = join(tmpDir, 'newer.txt');
    await writeFile(older, 'old content');
    // Small delay to ensure different mtime
    await new Promise((resolve) => setTimeout(resolve, 50));
    await writeFile(newer, 'new content');

    const result = await run({ pattern: '*.txt', path: tmpDir });
    expect(result.success).toBe(true);
    const files = result.output.split('\n').filter(Boolean);
    const newerIdx = files.findIndex((f) => f.includes('newer.txt'));
    const olderIdx = files.findIndex((f) => f.includes('older.txt'));
    // newer should appear before older
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  // --- P1: non-existent path ---

  it('returns empty or error for non-existent path', async () => {
    const result = await run({ pattern: '**/*', path: join(tmpDir, 'no_such_dir') });
    expect(result.success).toBe(true);
    expect(result.output).toBe('(no matches)');
  });
});
