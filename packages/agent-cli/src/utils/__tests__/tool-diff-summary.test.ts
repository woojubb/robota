import { describe, expect, it } from 'vitest';
import { buildToolDiffSummary } from '../tool-diff-summary.js';
import type { IDiffLine } from '../edit-diff.js';

describe('buildToolDiffSummary', () => {
  it('builds a markdown diff fenced body while preserving file metadata', () => {
    const lines: IDiffLine[] = [
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
});
