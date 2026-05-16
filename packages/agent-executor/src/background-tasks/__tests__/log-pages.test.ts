import { describe, expect, it } from 'vitest';
import {
  appendPrefixedLogLines,
  createBackgroundTaskLogPage,
  createLimitedOutputCapture,
} from '../log-pages.js';

describe('background task log helpers', () => {
  it('captures output until the byte limit and appends a truncation marker once', () => {
    const capture = createLimitedOutputCapture({ limitBytes: 5 });

    capture.appendOutput('hello');
    capture.appendOutput(' world');
    capture.appendOutput(' ignored');

    expect(capture.getOutput()).toBe('hello\n[output truncated]\n');
  });

  it('does not split a multibyte character while applying a byte limit', () => {
    const capture = createLimitedOutputCapture({ limitBytes: 4 });

    capture.appendOutput('가a');

    expect(capture.getOutput()).toBe('가a');
  });

  it('prefixes non-empty stdout and stderr lines', () => {
    const lines: string[] = [];

    appendPrefixedLogLines(lines, 'stdout', 'one\n\n');
    appendPrefixedLogLines(lines, 'stderr', 'two\r\nthree');

    expect(lines).toEqual(['[stdout] one', '[stderr] two', '[stderr] three']);
  });

  it('returns cursor-based log pages', () => {
    const lines = ['a', 'b', 'c'];

    const firstPage = createBackgroundTaskLogPage('task_1', lines, { offset: 0 }, 2);
    const secondPage = createBackgroundTaskLogPage('task_1', lines, firstPage.nextCursor, 2);

    expect(firstPage).toEqual({
      taskId: 'task_1',
      cursor: { offset: 0 },
      nextCursor: { offset: 2 },
      lines: ['a', 'b'],
    });
    expect(secondPage).toEqual({
      taskId: 'task_1',
      cursor: { offset: 2 },
      lines: ['c'],
    });
  });
});
