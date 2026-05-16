/**
 * Tests for EditTool
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { editTool } from '@robota-sdk/agent-tools';
import type { TToolResult } from '@robota-sdk/agent-tools';
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

  // --- Edge cases: indentation and whitespace ---

  it('preserves surrounding indentation when replacing', async () => {
    const filePath = join(tmpDir, 'indent.ts');
    const original = '  const a = 1;\n  const b = 2;\n  const c = 3;\n';
    await writeFile(filePath, original, 'utf8');

    const result = await run({
      filePath,
      oldString: '  const b = 2;',
      newString: '  const b = 99;',
    });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('  const a = 1;\n  const b = 99;\n  const c = 3;\n');
  });

  it('preserves tab indentation', async () => {
    const filePath = join(tmpDir, 'tabs.ts');
    const original = '\tfunction foo() {\n\t\treturn 1;\n\t}\n';
    await writeFile(filePath, original, 'utf8');

    const result = await run({
      filePath,
      oldString: '\t\treturn 1;',
      newString: '\t\treturn 42;',
    });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('\tfunction foo() {\n\t\treturn 42;\n\t}\n');
  });

  // --- Edge cases: position ---

  it('replaces string at file start', async () => {
    const filePath = join(tmpDir, 'start.txt');
    await writeFile(filePath, 'START middle end\n', 'utf8');

    const result = await run({ filePath, oldString: 'START', newString: 'BEGIN' });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('BEGIN middle end\n');
  });

  it('replaces string at file end', async () => {
    const filePath = join(tmpDir, 'end.txt');
    await writeFile(filePath, 'start middle END', 'utf8');

    const result = await run({ filePath, oldString: 'END', newString: 'FINISH' });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('start middle FINISH');
  });

  it('only modifies the matched portion, surrounding content is byte-identical', async () => {
    const filePath = join(tmpDir, 'precise.txt');
    const before = 'aaa\nbbb\nccc\n';
    const after = 'aaa\nBBB\nccc\n';
    await writeFile(filePath, before, 'utf8');

    const result = await run({ filePath, oldString: 'bbb', newString: 'BBB' });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe(after);
  });

  // --- Edge cases: special characters ---

  it('handles regex metacharacters in oldString', async () => {
    const filePath = join(tmpDir, 'regex.txt');
    await writeFile(filePath, 'price is $100.00 (USD)\n', 'utf8');

    const result = await run({
      filePath,
      oldString: '$100.00 (USD)',
      newString: '$200.00 (EUR)',
    });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('price is $200.00 (EUR)\n');
  });

  it('handles brackets and braces', async () => {
    const filePath = join(tmpDir, 'brackets.ts');
    await writeFile(filePath, 'const arr = [1, 2, 3];\nconst obj = { a: 1 };\n', 'utf8');

    const result = await run({
      filePath,
      oldString: 'const arr = [1, 2, 3];',
      newString: 'const arr = [4, 5, 6];',
    });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('const arr = [4, 5, 6];\nconst obj = { a: 1 };\n');
  });

  // --- Edge cases: unicode ---

  it('handles Korean characters', async () => {
    const filePath = join(tmpDir, 'korean.txt');
    await writeFile(filePath, '안녕하세요 세계\n', 'utf8');

    const result = await run({
      filePath,
      oldString: '안녕하세요',
      newString: '반갑습니다',
    });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('반갑습니다 세계\n');
  });

  it('handles emoji characters', async () => {
    const filePath = join(tmpDir, 'emoji.txt');
    await writeFile(filePath, 'hello 🌍 world\n', 'utf8');

    const result = await run({ filePath, oldString: '🌍', newString: '🌎' });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('hello 🌎 world\n');
  });

  // --- Edge cases: trailing newline ---

  it('preserves trailing newline', async () => {
    const filePath = join(tmpDir, 'trailing.txt');
    await writeFile(filePath, 'foo\nbar\n', 'utf8');

    const result = await run({ filePath, oldString: 'foo', newString: 'baz' });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('baz\nbar\n');
  });

  it('preserves file without trailing newline', async () => {
    const filePath = join(tmpDir, 'no-trailing.txt');
    await writeFile(filePath, 'foo\nbar', 'utf8');

    const result = await run({ filePath, oldString: 'bar', newString: 'baz' });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('foo\nbaz');
  });

  // --- Edge cases: CRLF ---

  it('handles Windows line endings (CRLF)', async () => {
    const filePath = join(tmpDir, 'crlf.txt');
    await writeFile(filePath, 'line1\r\nline2\r\nline3\r\n', 'utf8');

    const result = await run({
      filePath,
      oldString: 'line2',
      newString: 'LINE2',
    });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('line1\r\nLINE2\r\nline3\r\n');
  });

  // --- Edge cases: empty / same string ---

  it('replaces with empty string (deletion)', async () => {
    const filePath = join(tmpDir, 'delete.txt');
    await writeFile(filePath, 'keep remove keep\n', 'utf8');

    const result = await run({ filePath, oldString: ' remove', newString: '' });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('keep keep\n');
  });

  // --- Edge cases: large file ---

  it('correctly edits a large file', async () => {
    const filePath = join(tmpDir, 'large.txt');
    const lines = Array.from({ length: 10000 }, (_, i) => `line ${i + 1}`);
    lines[4999] = 'TARGET_LINE';
    await writeFile(filePath, lines.join('\n') + '\n', 'utf8');

    const result = await run({ filePath, oldString: 'TARGET_LINE', newString: 'REPLACED_LINE' });
    expect(result.success).toBe(true);

    const content = await readFile(filePath, 'utf8');
    const updatedLines = content.split('\n');
    expect(updatedLines[4999]).toBe('REPLACED_LINE');
    expect(updatedLines[4998]).toBe('line 4999');
    expect(updatedLines[5000]).toBe('line 5001');
    expect(updatedLines.length).toBe(10001); // 10000 lines + trailing newline empty
  });
});
