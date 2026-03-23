import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateDiffLines, generateDiffLinesWithContext, extractEditDiff } from '../edit-diff.js';

describe('generateDiffLines', () => {
  it('single line change: 1 remove + 1 add', () => {
    const lines = generateDiffLines('hello', 'world');
    expect(lines).toEqual([
      { type: 'remove', text: 'hello', lineNumber: 1 },
      { type: 'add', text: 'world', lineNumber: 1 },
    ]);
  });

  it('multi-line change: each old line is remove, each new line is add', () => {
    const lines = generateDiffLines('line1\nline2\nline3', 'lineA\nlineB');
    expect(lines.filter((l) => l.type === 'remove')).toHaveLength(3);
    expect(lines.filter((l) => l.type === 'add')).toHaveLength(2);
    expect(lines[0]).toEqual({ type: 'remove', text: 'line1', lineNumber: 1 });
    expect(lines[1]).toEqual({ type: 'remove', text: 'line2', lineNumber: 2 });
    expect(lines[2]).toEqual({ type: 'remove', text: 'line3', lineNumber: 3 });
    expect(lines[3]).toEqual({ type: 'add', text: 'lineA', lineNumber: 1 });
    expect(lines[4]).toEqual({ type: 'add', text: 'lineB', lineNumber: 2 });
  });

  it('identical strings return empty array', () => {
    expect(generateDiffLines('same', 'same')).toEqual([]);
  });

  it('empty old string (new content) returns only add lines', () => {
    const lines = generateDiffLines('', 'new line');
    expect(lines.filter((l) => l.type === 'remove')).toHaveLength(1); // '' splits to ['']
    expect(lines.filter((l) => l.type === 'add')).toHaveLength(1);
  });

  it('empty new string (deletion) returns only remove lines', () => {
    const lines = generateDiffLines('old line', '');
    expect(lines.filter((l) => l.type === 'remove')).toHaveLength(1);
    expect(lines.filter((l) => l.type === 'add')).toHaveLength(1); // '' splits to ['']
  });

  it('marks ALL old lines as remove and ALL new lines as add (no smart diff)', () => {
    // Even when some lines are the same, the function does not detect unchanged lines
    const lines = generateDiffLines('shared\nold', 'shared\nnew');
    expect(lines).toEqual([
      { type: 'remove', text: 'shared', lineNumber: 1 },
      { type: 'remove', text: 'old', lineNumber: 2 },
      { type: 'add', text: 'shared', lineNumber: 1 },
      { type: 'add', text: 'new', lineNumber: 2 },
    ]);
  });

  it('default startLine is 1', () => {
    const lines = generateDiffLines('a', 'b');
    expect(lines[0]).toEqual({ type: 'remove', text: 'a', lineNumber: 1 });
    expect(lines[1]).toEqual({ type: 'add', text: 'b', lineNumber: 1 });
  });

  it('custom startLine produces correct line numbers', () => {
    const lines = generateDiffLines('a', 'b', 42);
    expect(lines[0]).toEqual({ type: 'remove', text: 'a', lineNumber: 42 });
    expect(lines[1]).toEqual({ type: 'add', text: 'b', lineNumber: 42 });
  });

  it('multi-line with startLine: remove lines get startLine, startLine+1, etc.', () => {
    const lines = generateDiffLines('line1\nline2\nline3', 'lineA\nlineB', 10);
    expect(lines[0]).toEqual({ type: 'remove', text: 'line1', lineNumber: 10 });
    expect(lines[1]).toEqual({ type: 'remove', text: 'line2', lineNumber: 11 });
    expect(lines[2]).toEqual({ type: 'remove', text: 'line3', lineNumber: 12 });
    expect(lines[3]).toEqual({ type: 'add', text: 'lineA', lineNumber: 10 });
    expect(lines[4]).toEqual({ type: 'add', text: 'lineB', lineNumber: 11 });
  });
});

describe('diff line correctness', () => {
  it('single line replacement produces exactly 1 remove + 1 add', () => {
    const lines = generateDiffLines('const a = 1;', 'const a = 2;');
    expect(lines).toEqual([
      { type: 'remove', text: 'const a = 1;', lineNumber: 1 },
      { type: 'add', text: 'const a = 2;', lineNumber: 1 },
    ]);
  });

  it('multi-line: all old lines are remove, all new lines are add', () => {
    const old = 'line1\nline2\nline3';
    const newStr = 'lineA\nlineB';
    const lines = generateDiffLines(old, newStr);
    expect(lines.filter((l) => l.type === 'remove')).toHaveLength(3);
    expect(lines.filter((l) => l.type === 'add')).toHaveLength(2);
    expect(lines[0]).toEqual({ type: 'remove', text: 'line1', lineNumber: 1 });
    expect(lines[3]).toEqual({ type: 'add', text: 'lineA', lineNumber: 1 });
  });

  it('remove lines come before add lines', () => {
    const lines = generateDiffLines('old', 'new');
    const removeIdx = lines.findIndex((l) => l.type === 'remove');
    const addIdx = lines.findIndex((l) => l.type === 'add');
    expect(removeIdx).toBeLessThan(addIdx);
  });

  it('preserves whitespace in diff lines', () => {
    const lines = generateDiffLines('  indented old', '    more indented new');
    expect(lines[0].text).toBe('  indented old');
    expect(lines[1].text).toBe('    more indented new');
  });

  it('handles empty lines within content', () => {
    const lines = generateDiffLines('a\n\nb', 'x\n\ny');
    expect(lines).toHaveLength(6); // 3 remove + 3 add
    expect(lines[1]).toEqual({ type: 'remove', text: '', lineNumber: 2 });
    expect(lines[4]).toEqual({ type: 'add', text: '', lineNumber: 2 });
  });
});

describe('extractEditDiff', () => {
  it('Edit tool with valid args returns file and lines', () => {
    const result = extractEditDiff('Edit', {
      file_path: '/src/index.ts',
      old_string: 'hello',
      new_string: 'world',
    });
    expect(result).not.toBeNull();
    expect(result!.file).toBe('/src/index.ts');
    expect(result!.lines).toEqual([
      { type: 'remove', text: 'hello', lineNumber: 1 },
      { type: 'add', text: 'world', lineNumber: 1 },
    ]);
  });

  it('non-Edit tool returns null', () => {
    expect(
      extractEditDiff('Read', {
        file_path: '/src/index.ts',
        old_string: 'a',
        new_string: 'b',
      }),
    ).toBeNull();
  });

  it('missing toolArgs returns null', () => {
    expect(extractEditDiff('Edit')).toBeNull();
    expect(extractEditDiff('Edit', undefined)).toBeNull();
  });

  it('missing file_path returns null', () => {
    expect(
      extractEditDiff('Edit', {
        old_string: 'a',
        new_string: 'b',
      }),
    ).toBeNull();
  });

  it('missing old_string returns null', () => {
    expect(
      extractEditDiff('Edit', {
        file_path: '/src/index.ts',
        new_string: 'b',
      }),
    ).toBeNull();
  });

  it('missing new_string returns null', () => {
    expect(
      extractEditDiff('Edit', {
        file_path: '/src/index.ts',
        old_string: 'a',
      }),
    ).toBeNull();
  });

  it('identical old_string and new_string returns null', () => {
    expect(
      extractEditDiff('Edit', {
        file_path: '/src/index.ts',
        old_string: 'same',
        new_string: 'same',
      }),
    ).toBeNull();
  });

  it('handles camelCase field names (filePath, oldString, newString)', () => {
    const result = extractEditDiff('Edit', {
      filePath: '/src/index.ts',
      oldString: 'old',
      newString: 'new',
    });
    expect(result).not.toBeNull();
    expect(result!.file).toBe('/src/index.ts');
    expect(result!.lines).toHaveLength(2);
  });

  it('handles snake_case field names (file_path, old_string, new_string)', () => {
    const result = extractEditDiff('Edit', {
      file_path: '/src/main.ts',
      old_string: 'foo',
      new_string: 'bar',
    });
    expect(result).not.toBeNull();
    expect(result!.file).toBe('/src/main.ts');
  });

  it('prefers snake_case over camelCase when both present', () => {
    const result = extractEditDiff('Edit', {
      file_path: '/snake.ts',
      filePath: '/camel.ts',
      old_string: 'a',
      oldString: 'x',
      new_string: 'b',
      newString: 'y',
    });
    expect(result).not.toBeNull();
    expect(result!.file).toBe('/snake.ts');
  });

  it('accepts optional startLine parameter', () => {
    const result = extractEditDiff(
      'Edit',
      {
        file_path: '/src/index.ts',
        old_string: 'hello',
        new_string: 'world',
      },
      5,
    );
    expect(result).not.toBeNull();
    expect(result!.lines).toEqual([
      { type: 'remove', text: 'hello', lineNumber: 5 },
      { type: 'add', text: 'world', lineNumber: 5 },
    ]);
  });

  it('defaults startLine to 1 when not provided', () => {
    const result = extractEditDiff('Edit', {
      file_path: '/src/index.ts',
      old_string: 'a',
      new_string: 'b',
    });
    expect(result).not.toBeNull();
    expect(result!.lines[0].lineNumber).toBe(1);
    expect(result!.lines[1].lineNumber).toBe(1);
  });
});

// ─── Regression tests: context lines, absolute line numbers, startLine resolution ───

describe('generateDiffLinesWithContext', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function makeTempFile(content: string): string {
    tmpDir = mkdtempSync(join(tmpdir(), 'edit-diff-test-'));
    const filePath = join(tmpDir, 'test.ts');
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  it('should include 2 context lines before the change', () => {
    // 10-line file, edit line 5 (replaced already in file)
    const fileLines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    // Simulate: line5 was replaced with lineNEW
    const modifiedLines = [...fileLines];
    modifiedLines[4] = 'lineNEW';
    const filePath = makeTempFile(modifiedLines.join('\n'));

    const result = generateDiffLinesWithContext('line5', 'lineNEW', 5, filePath);

    // Context before: line3 (lineNumber=3) and line4 (lineNumber=4)
    const contextBefore = result.filter((l) => l.type === 'context' && l.lineNumber < 5);
    expect(contextBefore).toHaveLength(2);
    expect(contextBefore[0]).toEqual({ type: 'context', text: 'line3', lineNumber: 3 });
    expect(contextBefore[1]).toEqual({ type: 'context', text: 'line4', lineNumber: 4 });
  });

  it('should include 2 context lines after the change', () => {
    const fileLines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    const modifiedLines = [...fileLines];
    modifiedLines[4] = 'lineNEW';
    const filePath = makeTempFile(modifiedLines.join('\n'));

    const result = generateDiffLinesWithContext('line5', 'lineNEW', 5, filePath);

    // Context after: line6 (lineNumber=6) and line7 (lineNumber=7)
    const contextAfter = result.filter((l) => l.type === 'context' && l.lineNumber > 5);
    expect(contextAfter).toHaveLength(2);
    expect(contextAfter[0]).toEqual({ type: 'context', text: 'line6', lineNumber: 6 });
    expect(contextAfter[1]).toEqual({ type: 'context', text: 'line7', lineNumber: 7 });
  });

  it('should handle edit at start of file (no lines before)', () => {
    const fileLines = Array.from({ length: 5 }, (_, i) => `line${i + 1}`);
    const modifiedLines = [...fileLines];
    modifiedLines[0] = 'lineNEW';
    const filePath = makeTempFile(modifiedLines.join('\n'));

    const result = generateDiffLinesWithContext('line1', 'lineNEW', 1, filePath);

    const contextBefore = result.filter((l) => l.type === 'context' && l.lineNumber < 1);
    expect(contextBefore).toHaveLength(0);

    // Context after: line2, line3
    const contextAfter = result.filter((l) => l.type === 'context' && l.lineNumber > 1);
    expect(contextAfter).toHaveLength(2);
    expect(contextAfter[0]).toEqual({ type: 'context', text: 'line2', lineNumber: 2 });
    expect(contextAfter[1]).toEqual({ type: 'context', text: 'line3', lineNumber: 3 });
  });

  it('should handle edit at end of file (no lines after)', () => {
    const fileLines = Array.from({ length: 5 }, (_, i) => `line${i + 1}`);
    const modifiedLines = [...fileLines];
    modifiedLines[4] = 'lineNEW';
    const filePath = makeTempFile(modifiedLines.join('\n'));

    const result = generateDiffLinesWithContext('line5', 'lineNEW', 5, filePath);

    // Context before: line3, line4
    const contextBefore = result.filter((l) => l.type === 'context' && l.lineNumber < 5);
    expect(contextBefore).toHaveLength(2);

    // Context after: none (line5 is the last line)
    const contextAfter = result.filter((l) => l.type === 'context' && l.lineNumber > 5);
    expect(contextAfter).toHaveLength(0);
  });

  it('context lines should have type "context"', () => {
    const fileLines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    const modifiedLines = [...fileLines];
    modifiedLines[4] = 'lineNEW';
    const filePath = makeTempFile(modifiedLines.join('\n'));

    const result = generateDiffLinesWithContext('line5', 'lineNEW', 5, filePath);

    const contextLines = result.filter((l) => l.type === 'context');
    expect(contextLines.length).toBeGreaterThan(0);
    for (const line of contextLines) {
      expect(line.type).toBe('context');
    }
  });

  it('all lines should have absolute lineNumber', () => {
    const fileLines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    const modifiedLines = [...fileLines];
    modifiedLines[4] = 'lineNEW';
    const filePath = makeTempFile(modifiedLines.join('\n'));

    const result = generateDiffLinesWithContext('line5', 'lineNEW', 5, filePath);

    for (const line of result) {
      expect(typeof line.lineNumber).toBe('number');
      expect(line.lineNumber).toBeGreaterThan(0);
    }
  });

  it('returns diff without context when file is not readable', () => {
    const result = generateDiffLinesWithContext('old', 'new', 5, '/nonexistent/path/file.ts');

    // Should still return diff lines, just no context
    expect(result.length).toBeGreaterThan(0);
    const contextLines = result.filter((l) => l.type === 'context');
    expect(contextLines).toHaveLength(0);
  });

  it('identical strings return empty array', () => {
    const filePath = makeTempFile('some content');
    const result = generateDiffLinesWithContext('same', 'same', 1, filePath);
    expect(result).toEqual([]);
  });
});

describe('extractEditDiff startLine resolution', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function makeTempFile(content: string): string {
    tmpDir = mkdtempSync(join(tmpdir(), 'edit-diff-test-'));
    const filePath = join(tmpDir, 'test.ts');
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  it('should use provided startLine', () => {
    const result = extractEditDiff(
      'Edit',
      {
        file_path: '/nonexistent/file.ts',
        old_string: 'hello',
        new_string: 'world',
      },
      42,
    );
    expect(result).not.toBeNull();
    const removeLines = result!.lines.filter((l) => l.type === 'remove');
    expect(removeLines[0].lineNumber).toBe(42);
  });

  it('should resolve startLine from file when not provided', () => {
    // Create file where newStr appears at line 4
    const content = 'line1\nline2\nline3\nREPLACED\nline5';
    const filePath = makeTempFile(content);

    const result = extractEditDiff('Edit', {
      file_path: filePath,
      old_string: 'original',
      new_string: 'REPLACED',
    });

    expect(result).not.toBeNull();
    // newStr "REPLACED" is at line 4 in the file
    const removeLines = result!.lines.filter((l) => l.type === 'remove');
    expect(removeLines[0].lineNumber).toBe(4);
    const addLines = result!.lines.filter((l) => l.type === 'add');
    expect(addLines[0].lineNumber).toBe(4);
  });

  it('should fall back to line 1 when file not readable', () => {
    const result = extractEditDiff('Edit', {
      file_path: '/nonexistent/path/file.ts',
      old_string: 'a',
      new_string: 'b',
    });
    expect(result).not.toBeNull();
    expect(result!.lines[0].lineNumber).toBe(1);
  });

  it('should fall back to line 1 when newString not found in file', () => {
    const content = 'line1\nline2\nline3';
    const filePath = makeTempFile(content);

    const result = extractEditDiff('Edit', {
      file_path: filePath,
      old_string: 'something',
      new_string: 'NOT_IN_FILE_ANYWHERE',
    });
    expect(result).not.toBeNull();
    expect(result!.lines[0].lineNumber).toBe(1);
  });
});

describe('IDiffLine data shape', () => {
  it('every diff line has lineNumber field', () => {
    const lines = generateDiffLines('old', 'new', 10);
    for (const line of lines) {
      expect(typeof line.lineNumber).toBe('number');
      expect(line.lineNumber).toBeGreaterThan(0);
    }
  });

  it('context + remove + add all have correct types', () => {
    let tmpDir: string | undefined;
    try {
      tmpDir = mkdtempSync(join(tmpdir(), 'edit-diff-test-'));
      const filePath = join(tmpDir, 'test.ts');
      const fileLines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
      const modifiedLines = [...fileLines];
      modifiedLines[4] = 'lineNEW';
      writeFileSync(filePath, modifiedLines.join('\n'), 'utf-8');

      const result = generateDiffLinesWithContext('line5', 'lineNEW', 5, filePath);

      const types = new Set(result.map((l) => l.type));
      expect(types.has('context')).toBe(true);
      expect(types.has('remove')).toBe(true);
      expect(types.has('add')).toBe(true);

      // Verify order: context before, then remove, then add, then context after
      const firstContext = result.findIndex((l) => l.type === 'context');
      const firstRemove = result.findIndex((l) => l.type === 'remove');
      const firstAdd = result.findIndex((l) => l.type === 'add');
      expect(firstContext).toBeLessThan(firstRemove);
      expect(firstRemove).toBeLessThan(firstAdd);
    } finally {
      if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });

  it('multi-line diff lines all have lineNumber', () => {
    const lines = generateDiffLines('a\nb\nc', 'x\ny', 15);
    expect(lines).toHaveLength(5); // 3 remove + 2 add
    for (const line of lines) {
      expect(typeof line.lineNumber).toBe('number');
      expect(line.lineNumber).toBeGreaterThanOrEqual(15);
    }
  });
});
