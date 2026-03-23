import { describe, it, expect } from 'vitest';
import { generateDiffLines, extractEditDiff } from '../edit-diff.js';

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
