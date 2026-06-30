/**
 * TC-01 through TC-07 for ADOPT-006: dag run --watch output diff
 */
import { describe, expect, it } from 'vitest';
import { computeLineDiff, getMainOutput, WATCH_DIFF_MAX_CHANGED_LINES } from '../lib/line-diff.js';
import type { ILocalRunResult } from '../local-runner/local-dag-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

function makeResult(outputsByNode: Record<string, Record<string, string>>): ILocalRunResult {
  return {
    dagRun: {
      dagRunId: 'run-1',
      dagId: 'test',
      version: 1,
      status: 'success',
      runKey: 'test:manual:1',
      logicalDate: new Date().toISOString(),
      trigger: 'manual',
    },
    taskRuns: Object.entries(outputsByNode).map(([nodeId, outputs]) => ({
      taskRunId: `task-${nodeId}`,
      dagRunId: 'run-1',
      nodeId,
      status: 'success' as const,
      attempt: 1,
      outputSnapshot: JSON.stringify(outputs),
    })),
  };
}

// ---------------------------------------------------------------------------
// TC-01: watch mode shows only changed lines with -/+ prefix, not full output
// ---------------------------------------------------------------------------

describe('ADOPT-006 — watch output diff', () => {
  it('TC-01: diff output contains only changed lines, not full output', () => {
    const before = 'Hello, world!\nThe answer is 42.';
    const after = 'Hello, universe!\nThe answer is 42.';

    const { output } = computeLineDiff(before, after);

    expect(output).toContain('Hello, world!');
    expect(output).toContain('Hello, universe!');
    // Unchanged line must NOT appear in diff output
    expect(output).not.toMatch(/^[^-+].*The answer is 42/m);
  });

  // -------------------------------------------------------------------------
  // TC-02: removed lines prefixed with `-` and displayed in red (ANSI)
  // -------------------------------------------------------------------------

  it('TC-02: removed lines have ANSI red prefix and - marker', () => {
    const before = 'line A\nline B\nline C';
    const after = 'line A\nline C';

    const { output } = computeLineDiff(before, after);

    expect(output).toContain(`${RED}- line B${RESET}`);
  });

  // -------------------------------------------------------------------------
  // TC-03: added lines prefixed with `+` and displayed in green (ANSI)
  // -------------------------------------------------------------------------

  it('TC-03: added lines have ANSI green prefix and + marker', () => {
    const before = 'line A\nline C';
    const after = 'line A\nline B\nline C';

    const { output } = computeLineDiff(before, after);

    expect(output).toContain(`${GREEN}+ line B${RESET}`);
  });

  // -------------------------------------------------------------------------
  // TC-04: identical output → { totalChanged: 0, output: '' }
  // -------------------------------------------------------------------------

  it('TC-04: identical strings produce zero changed lines and empty output', () => {
    const text = 'Hello, world!\nThe answer is 42.';

    const { output, totalChanged } = computeLineDiff(text, text);

    expect(totalChanged).toBe(0);
    expect(output).toBe('');
  });

  // -------------------------------------------------------------------------
  // TC-05: diff > 50 changed lines → truncated=true, totalChanged reflects full count
  // -------------------------------------------------------------------------

  it('TC-05: diff exceeding max changed lines is truncated', () => {
    const beforeLines = Array.from({ length: 60 }, (_, i) => `old line ${i}`);
    const afterLines = Array.from({ length: 60 }, (_, i) => `new line ${i}`);
    const before = beforeLines.join('\n');
    const after = afterLines.join('\n');

    const { truncated, totalChanged, output } = computeLineDiff(before, after);

    expect(truncated).toBe(true);
    expect(totalChanged).toBeGreaterThan(WATCH_DIFF_MAX_CHANGED_LINES);
    // Output must contain exactly WATCH_DIFF_MAX_CHANGED_LINES lines
    const displayedLines = output
      .split('\n')
      .filter((l) => l.startsWith(RED) || l.startsWith(GREEN));
    expect(displayedLines).toHaveLength(WATCH_DIFF_MAX_CHANGED_LINES);
  });

  it('TC-05b: --show-full bypasses truncation', () => {
    const beforeLines = Array.from({ length: 60 }, (_, i) => `old line ${i}`);
    const afterLines = Array.from({ length: 60 }, (_, i) => `new line ${i}`);

    const { truncated } = computeLineDiff(beforeLines.join('\n'), afterLines.join('\n'), {
      showFull: true,
    });

    expect(truncated).toBe(false);
  });

  // -------------------------------------------------------------------------
  // TC-06: getMainOutput extracts string port values from outputSnapshot
  // (proxy for watch --no-diff: full output is extracted from the run result)
  // -------------------------------------------------------------------------

  it('TC-06: getMainOutput extracts string values from outputSnapshot', () => {
    const result = makeResult({ 'text-output': { text: 'Hello, world!' } });

    const output = getMainOutput(result);

    expect(output).toContain('Hello, world!');
  });

  it('TC-06b: getMainOutput returns empty string for missing outputSnapshot', () => {
    const result: ILocalRunResult = {
      dagRun: {
        dagRunId: 'run-1',
        dagId: 'test',
        version: 1,
        status: 'success',
        runKey: 'test:manual:1',
        logicalDate: new Date().toISOString(),
        trigger: 'manual',
      },
      taskRuns: [
        { taskRunId: 'task-a', dagRunId: 'run-1', nodeId: 'a', status: 'success', attempt: 1 },
      ],
    };

    expect(getMainOutput(result)).toBe('');
  });

  // -------------------------------------------------------------------------
  // TC-07: help text contains --no-diff
  // -------------------------------------------------------------------------

  it('TC-07: run command help text contains --no-diff', async () => {
    const { runCommand } = await import('../commands/run.js');
    const written: string[] = [];
    const exitCode = await runCommand(['--help'], {
      io: {
        write: (t) => {
          written.push(t);
        },
        writeError: (t) => {
          written.push(t);
        },
        readTextFile: async () => {
          throw new Error('unexpected');
        },
        writeBinaryStream: async () => {},
      },
      createRunner: () => {
        throw new Error('unexpected');
      },
    });

    const output = written.join('');
    expect(exitCode).toBe(0);
    expect(output).toContain('--no-diff');
  });
});
