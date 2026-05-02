import { describe, expect, it } from 'vitest';
import { buildToolDiffSummary } from '../tool-diff-summary.js';
import type { IDiffLine } from '../edit-diff.js';

describe('buildToolDiffSummary', () => {
  it('builds a markdown diff fenced body while preserving file metadata', () => {
    const lines: IDiffLine[] = [
      { type: 'hunk', lineNumber: 10, text: '@@ -10,2 +10,2 @@' },
      { type: 'context', lineNumber: 10, text: 'const before = true;' },
      { type: 'remove', lineNumber: 11, text: 'const value = false;' },
      { type: 'add', lineNumber: 11, text: 'const value = true;' },
    ];

    const summary = buildToolDiffSummary({ file: '/src/index.ts', lines });

    expect(summary.file).toBe('/src/index.ts');
    expect(summary.truncated).toBe(false);
    expect(summary.remainingLineCount).toBe(0);
    expect(summary.markdown).toBe(
      [
        '```diff',
        '@@ -10,2 +10,2 @@',
        '  10 | const before = true;',
        '- 11 | const value = false;',
        '+ 11 | const value = true;',
        '```',
      ].join('\n'),
    );
  });

  it('truncates long diff bodies while keeping truncation metadata outside markdown', () => {
    const lines = Array.from({ length: 13 }, (_, index): IDiffLine => {
      const lineNumber = index + 1;
      return {
        type: index % 2 === 0 ? 'remove' : 'add',
        lineNumber,
        text: `line ${lineNumber}`,
      };
    });

    const summary = buildToolDiffSummary({ lines });

    expect(summary.truncated).toBe(true);
    expect(summary.remainingLineCount).toBe(3);
    expect(summary.markdown).toContain('-  1 | line 1');
    expect(summary.markdown).toContain('+ 10 | line 10');
    expect(summary.markdown).not.toContain('line 11');
    expect(summary.markdown).not.toContain('more lines');
  });

  it('preserves the first hunk when truncating multi-hunk diffs', () => {
    const lines: IDiffLine[] = [
      { type: 'hunk', lineNumber: 1, text: '@@ -1,4 +1,4 @@' },
      { type: 'context', lineNumber: 1, text: 'one' },
      { type: 'remove', lineNumber: 2, text: 'two-old' },
      { type: 'add', lineNumber: 2, text: 'two-new' },
      { type: 'context', lineNumber: 3, text: 'three' },
      { type: 'hunk', lineNumber: 20, text: '@@ -20,4 +20,4 @@' },
      { type: 'context', lineNumber: 20, text: 'twenty' },
      { type: 'remove', lineNumber: 21, text: 'twenty-one-old' },
      { type: 'add', lineNumber: 21, text: 'twenty-one-new' },
      { type: 'context', lineNumber: 22, text: 'twenty-two' },
      { type: 'hunk', lineNumber: 40, text: '@@ -40,4 +40,4 @@' },
      { type: 'context', lineNumber: 40, text: 'forty' },
      { type: 'remove', lineNumber: 41, text: 'forty-one-old' },
      { type: 'add', lineNumber: 41, text: 'forty-one-new' },
      { type: 'context', lineNumber: 42, text: 'forty-two' },
    ];

    const summary = buildToolDiffSummary({ lines });

    expect(summary.truncated).toBe(true);
    expect(summary.remainingLineCount).toBe(5);
    expect(summary.markdown).toContain('@@ -1,4 +1,4 @@');
    expect(summary.markdown).toContain('two-new');
    expect(summary.markdown).toContain('@@ -20,4 +20,4 @@');
    expect(summary.markdown).not.toContain('@@ -40,4 +40,4 @@');
  });
});
