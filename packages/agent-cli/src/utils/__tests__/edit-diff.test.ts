import { describe, it, expect } from 'vitest';
import { generateDiffLines, extractEditDiff } from '../edit-diff.js';

describe('generateDiffLines', () => {
  it('single line change: 1 remove + 1 add', () => {
    const lines = generateDiffLines('hello', 'world');
    expect(lines).toEqual([
      { type: 'remove', text: 'hello' },
      { type: 'add', text: 'world' },
    ]);
  });

  it('multi-line change: each old line is remove, each new line is add', () => {
    const lines = generateDiffLines('line1\nline2\nline3', 'lineA\nlineB');
    expect(lines.filter((l) => l.type === 'remove')).toHaveLength(3);
    expect(lines.filter((l) => l.type === 'add')).toHaveLength(2);
    expect(lines[0]).toEqual({ type: 'remove', text: 'line1' });
    expect(lines[1]).toEqual({ type: 'remove', text: 'line2' });
    expect(lines[2]).toEqual({ type: 'remove', text: 'line3' });
    expect(lines[3]).toEqual({ type: 'add', text: 'lineA' });
    expect(lines[4]).toEqual({ type: 'add', text: 'lineB' });
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
      { type: 'remove', text: 'shared' },
      { type: 'remove', text: 'old' },
      { type: 'add', text: 'shared' },
      { type: 'add', text: 'new' },
    ]);
  });
});

describe('diff line correctness', () => {
  it('single line replacement produces exactly 1 remove + 1 add', () => {
    const lines = generateDiffLines('const a = 1;', 'const a = 2;');
    expect(lines).toEqual([
      { type: 'remove', text: 'const a = 1;' },
      { type: 'add', text: 'const a = 2;' },
    ]);
  });

  it('multi-line: all old lines are remove, all new lines are add', () => {
    const old = 'line1\nline2\nline3';
    const newStr = 'lineA\nlineB';
    const lines = generateDiffLines(old, newStr);
    expect(lines.filter((l) => l.type === 'remove')).toHaveLength(3);
    expect(lines.filter((l) => l.type === 'add')).toHaveLength(2);
    expect(lines[0]).toEqual({ type: 'remove', text: 'line1' });
    expect(lines[3]).toEqual({ type: 'add', text: 'lineA' });
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
    expect(lines[1]).toEqual({ type: 'remove', text: '' });
    expect(lines[4]).toEqual({ type: 'add', text: '' });
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
      { type: 'remove', text: 'hello' },
      { type: 'add', text: 'world' },
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
});
