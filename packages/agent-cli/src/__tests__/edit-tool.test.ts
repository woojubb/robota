/**
 * Tests for EditTool
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { editTool } from '../tools/edit-tool.js';
import type { TToolResult } from '../types.js';
import type { TToolParameters } from '@robota-sdk/agent-core';

async function run(params: TToolParameters): Promise<TToolResult> {
  const rawResult = await editTool.execute(params);
  return JSON.parse(rawResult.data as string) as TToolResult;
}

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'edit-tool-test-'));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('EditTool', () => {
  it('replaces a unique string in a file', async () => {
    const filePath = join(tmpDir, 'unique.txt');
    await writeFile(filePath, 'hello world\n', 'utf8');

    const result = await run({ filePath, oldString: 'hello', newString: 'goodbye' });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('goodbye world\n');
  });

  it('errors when oldString is not found', async () => {
    const filePath = join(tmpDir, 'notfound.txt');
    await writeFile(filePath, 'foo bar\n', 'utf8');

    const result = await run({ filePath, oldString: 'xyz', newString: 'abc' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('errors when oldString is not unique (appears multiple times)', async () => {
    const filePath = join(tmpDir, 'duplicate.txt');
    await writeFile(filePath, 'foo foo foo\n', 'utf8');

    const result = await run({ filePath, oldString: 'foo', newString: 'bar' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not unique');
    expect(result.error).toContain('3 occurrences');
  });

  it('replaceAll replaces all occurrences', async () => {
    const filePath = join(tmpDir, 'replaceall.txt');
    await writeFile(filePath, 'foo foo foo\n', 'utf8');

    const result = await run({ filePath, oldString: 'foo', newString: 'bar', replaceAll: true });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('bar bar bar\n');
  });

  it('errors for missing file', async () => {
    const result = await run({
      filePath: join(tmpDir, 'missing.txt'),
      oldString: 'x',
      newString: 'y',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('replaces multiline string', async () => {
    const filePath = join(tmpDir, 'multiline.txt');
    await writeFile(filePath, 'line1\nline2\nline3\n', 'utf8');

    const result = await run({
      filePath,
      oldString: 'line1\nline2',
      newString: 'lineA\nlineB',
    });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('lineA\nlineB\nline3\n');
  });

  it('reports occurrence count in output for replaceAll', async () => {
    const filePath = join(tmpDir, 'count.txt');
    await writeFile(filePath, 'x x x\n', 'utf8');

    const result = await run({ filePath, oldString: 'x', newString: 'y', replaceAll: true });
    expect(result.success).toBe(true);
    expect(result.output).toContain('3 occurrence');
  });
});
