import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyToolEnd,
  applyToolStart,
  pushToolSummaryToHistory,
} from '../interactive-session-streaming.js';
import type { IStreamingState } from '../interactive-session-streaming.js';

function createState(): IStreamingState {
  return {
    activeTools: [],
    history: [],
  };
}

describe('interactive-session-streaming edit diffs', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  function makeTempFile(content: string): string {
    tmpDir = mkdtempSync(join(tmpdir(), 'interactive-diff-test-'));
    const filePath = join(tmpDir, 'example.md');
    writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  it('attaches diff metadata when an Edit tool completes', () => {
    const filePath = makeTempFile(
      ['line four', 'line five', 'line six', 'line one', 'line eight', 'line nine'].join('\n'),
    );
    const state = createState();
    applyToolStart(state, {
      toolName: 'Edit',
      toolArgs: {
        filePath,
        oldString: 'line one\nline two\nline three',
        newString: 'line one',
      },
    });

    const finished = applyToolEnd(state, {
      type: 'end',
      toolName: 'Edit',
      toolArgs: {
        filePath,
        oldString: 'line one\nline two\nline three',
        newString: 'line one',
      },
      success: true,
      toolResultData: JSON.stringify({ success: true, startLine: 7 }),
    });

    expect(finished?.diffFile).toBe(filePath);
    expect(finished?.diffLines).toEqual(
      expect.arrayContaining([
        { type: 'hunk', text: '@@ -4,6 +4,4 @@', lineNumber: 4 },
        { type: 'remove', text: 'line one', lineNumber: 7 },
        { type: 'remove', text: 'line two', lineNumber: 8 },
        { type: 'remove', text: 'line three', lineNumber: 9 },
        { type: 'add', text: 'line one', lineNumber: 7 },
      ]),
    );
  });

  it('persists tool-summary diff metadata for later TUI rendering', () => {
    const state = createState();
    state.activeTools.push({
      toolName: 'Edit',
      firstArg: '/tmp/example.md',
      isRunning: false,
      result: 'success',
      diffFile: '/tmp/example.md',
      diffLines: [
        { type: 'remove', text: 'temporary line', lineNumber: 2 },
        { type: 'add', text: 'original line', lineNumber: 2 },
      ],
    });

    pushToolSummaryToHistory(state);

    expect(state.history[0]?.type).toBe('tool-summary');
    expect(state.history[0]?.data).toMatchObject({
      tools: [
        {
          toolName: 'Edit',
          diffFile: '/tmp/example.md',
          diffLines: [
            { type: 'remove', text: 'temporary line', lineNumber: 2 },
            { type: 'add', text: 'original line', lineNumber: 2 },
          ],
        },
      ],
    });
  });
});
