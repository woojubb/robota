import { describe, expect, it } from 'vitest';
import { formatCommandOutputSummary } from '../command-output-summary.js';

describe('formatCommandOutputSummary', () => {
  it('renders short command output inline without transcript decoration', () => {
    const summary = formatCommandOutputSummary({
      toolName: 'Bash',
      firstArg: 'echo hello',
      isRunning: false,
      result: 'success',
      toolResultData: JSON.stringify({ success: true, output: 'hello\n', exitCode: 0 }),
    });

    expect(summary).toMatchObject({
      status: 'success',
      statusLabel: 'ok',
      previewLines: ['hello'],
      omittedLineCount: 0,
      transcriptHint: undefined,
    });
  });

  it('renders long command output with a bounded preview and transcript hint', () => {
    const output = Array.from({ length: 8 }, (_, index) => `line-${index + 1}`).join('\n');
    const summary = formatCommandOutputSummary({
      toolName: 'Bash',
      firstArg: 'pnpm test',
      isRunning: false,
      result: 'success',
      toolResultData: JSON.stringify({ success: true, output, exitCode: 0 }),
    });

    expect(summary?.previewLines).toEqual(['line-1', 'line-2', 'line-3', 'line-4']);
    expect(summary?.omittedLineCount).toBe(4);
    expect(summary?.transcriptHint).toBe('... +4 lines (full output in session transcript)');
  });

  it('keeps stderr distinct when stdout and stderr are structured separately', () => {
    const summary = formatCommandOutputSummary({
      toolName: 'Bash',
      firstArg: 'node script.js',
      isRunning: false,
      result: 'success',
      toolResultData: JSON.stringify({
        success: true,
        stdout: 'ok',
        stderr: 'warn',
        exitCode: 0,
      }),
    });

    expect(summary?.previewLines).toEqual(['ok', '[stderr] warn']);
  });

  it('marks non-zero exit codes as failed even when the tool transport succeeded', () => {
    const summary = formatCommandOutputSummary({
      toolName: 'Bash',
      firstArg: 'exit 42',
      isRunning: false,
      result: 'success',
      toolResultData: JSON.stringify({ success: true, output: '', exitCode: 42 }),
    });

    expect(summary?.status).toBe('error');
    expect(summary?.statusLabel).toBe('exit 42');
    expect(summary?.previewLines).toEqual([]);
  });

  it('renders no-output commands without dangling transcript hints', () => {
    const summary = formatCommandOutputSummary({
      toolName: 'Bash',
      firstArg: 'true',
      isRunning: false,
      result: 'success',
      toolResultData: JSON.stringify({ success: true, output: '', exitCode: 0 }),
    });

    expect(summary?.status).toBe('success');
    expect(summary?.previewLines).toEqual([]);
    expect(summary?.omittedLineCount).toBe(0);
    expect(summary?.transcriptHint).toBeUndefined();
  });

  it('ignores non-command tools', () => {
    const summary = formatCommandOutputSummary({
      toolName: 'Read',
      firstArg: 'file.ts',
      isRunning: false,
      result: 'success',
      toolResultData: 'large file content',
    });

    expect(summary).toBeUndefined();
  });
});
