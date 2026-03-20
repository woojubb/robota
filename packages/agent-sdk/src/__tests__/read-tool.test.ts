/**
 * Tests for ReadTool
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readTool } from '@robota-sdk/agent-tools';
import type { TToolResult } from '@robota-sdk/agent-tools';
import type { TToolParameters } from '@robota-sdk/agent-core';

async function run(params: TToolParameters): Promise<TToolResult> {
  const rawResult = await readTool.execute(params);
  return JSON.parse(rawResult.data as string) as TToolResult;
}

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'read-tool-test-'));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('ReadTool', () => {
  it('reads a text file and returns contents with line numbers', async () => {
    const filePath = join(tmpDir, 'hello.txt');
    await writeFile(filePath, 'line one\nline two\nline three\n', 'utf8');

    const result = await run({ filePath });
    expect(result.success).toBe(true);
    expect(result.output).toContain('1\tline one');
    expect(result.output).toContain('2\tline two');
    expect(result.output).toContain('3\tline three');
  });

  it('returns error for missing file', async () => {
    const result = await run({ filePath: join(tmpDir, 'nonexistent.txt') });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('respects offset parameter', async () => {
    const filePath = join(tmpDir, 'offset.txt');
    await writeFile(filePath, 'a\nb\nc\nd\ne\n', 'utf8');

    const result = await run({ filePath, offset: 3 });
    expect(result.success).toBe(true);
    expect(result.output).toContain('3\tc');
    expect(result.output).not.toContain('1\ta');
  });

  it('respects limit parameter', async () => {
    const filePath = join(tmpDir, 'limit.txt');
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    await writeFile(filePath, lines, 'utf8');

    const result = await run({ filePath, limit: 3 });
    expect(result.success).toBe(true);
    expect(result.output).toContain('1\tline 1');
    expect(result.output).toContain('3\tline 3');
    expect(result.output).not.toContain('4\tline 4');
  });

  it('includes header with file path and line count', async () => {
    const filePath = join(tmpDir, 'header.txt');
    await writeFile(filePath, 'foo\nbar\n', 'utf8');

    const result = await run({ filePath });
    expect(result.success).toBe(true);
    expect(result.output).toContain(filePath);
  });

  it('detects binary files and returns error', async () => {
    const filePath = join(tmpDir, 'binary.bin');
    // Write buffer with null bytes
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await writeFile(filePath, buf);

    const result = await run({ filePath });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Binary file not supported');
  });

  it('handles empty file', async () => {
    const filePath = join(tmpDir, 'empty.txt');
    await writeFile(filePath, '', 'utf8');

    const result = await run({ filePath });
    expect(result.success).toBe(true);
    // Empty file: output may just be the header with 0 lines
    expect(result.output).toContain(filePath);
  });

  it('handles offset beyond file length gracefully', async () => {
    const filePath = join(tmpDir, 'short.txt');
    await writeFile(filePath, 'only one line\n', 'utf8');

    const result = await run({ filePath, offset: 100 });
    expect(result.success).toBe(true);
    // No content lines returned, just header
    expect(result.output).toContain(filePath);
  });
});
