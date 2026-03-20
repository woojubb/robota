/**
 * Tests for WriteTool
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeTool } from '@robota-sdk/agent-tools';
import type { TToolResult } from '@robota-sdk/agent-tools';
import type { TToolParameters } from '@robota-sdk/agent-core';

async function run(params: TToolParameters): Promise<TToolResult> {
  const rawResult = await writeTool.execute(params);
  return JSON.parse(rawResult.data as string) as TToolResult;
}

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'write-tool-test-'));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('WriteTool', () => {
  it('writes content to a new file', async () => {
    const filePath = join(tmpDir, 'output.txt');
    const result = await run({ filePath, content: 'hello world' });
    expect(result.success).toBe(true);

    const written = await readFile(filePath, 'utf8');
    expect(written).toBe('hello world');
  });

  it('overwrites an existing file', async () => {
    const filePath = join(tmpDir, 'overwrite.txt');
    await run({ filePath, content: 'initial content' });

    const result = await run({ filePath, content: 'updated content' });
    expect(result.success).toBe(true);

    const written = await readFile(filePath, 'utf8');
    expect(written).toBe('updated content');
  });

  it('auto-creates nested parent directories', async () => {
    const filePath = join(tmpDir, 'a', 'b', 'c', 'nested.txt');
    const result = await run({ filePath, content: 'deep file' });
    expect(result.success).toBe(true);

    const written = await readFile(filePath, 'utf8');
    expect(written).toBe('deep file');
  });

  it('reports bytes written in output message', async () => {
    const filePath = join(tmpDir, 'size.txt');
    const content = 'abc';
    const result = await run({ filePath, content });
    expect(result.success).toBe(true);
    expect(result.output).toContain(String(content.length));
  });

  it('writes empty string', async () => {
    const filePath = join(tmpDir, 'empty.txt');
    const result = await run({ filePath, content: '' });
    expect(result.success).toBe(true);

    const written = await readFile(filePath, 'utf8');
    expect(written).toBe('');
  });

  it('writes unicode content correctly', async () => {
    const filePath = join(tmpDir, 'unicode.txt');
    const content = '안녕하세요 🎉 émoji';
    const result = await run({ filePath, content });
    expect(result.success).toBe(true);

    const written = await readFile(filePath, 'utf8');
    expect(written).toBe(content);
  });

  // --- P0: output reports content.length (JS chars, not bytes) ---

  it('reports correct byte count for multibyte content', async () => {
    const filePath = join(tmpDir, 'multibyte.txt');
    const content = '한글테스트'; // 5 chars, 15 bytes in UTF-8
    const result = await run({ filePath, content });
    expect(result.success).toBe(true);
    expect(result.output).toContain('15 bytes');
  });

  // --- P1: write to path where directory name conflicts ---

  it('errors when writing to a path that is a directory', async () => {
    const dirPath = join(tmpDir, 'adir');
    await mkdir(dirPath, { recursive: true });
    const result = await run({ filePath: dirPath, content: 'test' });
    expect(result.success).toBe(false);
  });
});
