import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
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
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), 'interactive-diff-test-')));
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

  it('persists command tool result data for collapsed transcript rendering', () => {
    const state = createState();
    applyToolStart(state, {
      toolName: 'Bash',
      toolArgs: { command: 'pnpm test' },
    });

    const toolResultData = JSON.stringify({
      success: true,
      output: 'line-1\nline-2',
      exitCode: 0,
    });
    const finished = applyToolEnd(state, {
      type: 'end',
      toolName: 'Bash',
      toolArgs: { command: 'pnpm test' },
      success: true,
      toolResultData,
    });

    expect(finished?.toolResultData).toBe(toolResultData);
    pushToolSummaryToHistory(state);
    expect(state.history[2]?.data).toMatchObject({
      tools: [
        {
          toolName: 'Bash',
          firstArg: 'pnpm test',
          toolResultData,
        },
      ],
    });
  });
});

describe('#3288: extending the diff builder to Write', () => {
  it('attaches diff metadata (all `add` lines, capped) when a Write tool completes', () => {
    const state = createState();
    applyToolStart(state, {
      toolName: 'Write',
      toolArgs: { filePath: '/tmp/new-file.md', content: 'line one\nline two\nline three' },
    });

    const finished = applyToolEnd(state, {
      type: 'end',
      toolName: 'Write',
      toolArgs: { filePath: '/tmp/new-file.md', content: 'line one\nline two\nline three' },
      success: true,
    });

    expect(finished?.diffFile).toBe('/tmp/new-file.md');
    expect(finished?.diffLines).toEqual([
      { type: 'hunk', text: '@@ -0,0 +1,3 @@', lineNumber: 1 },
      { type: 'add', text: 'line one', lineNumber: 1 },
      { type: 'add', text: 'line two', lineNumber: 2 },
      { type: 'add', text: 'line three', lineNumber: 3 },
    ]);
  });

  it('caps a large Write with a truncated marker rather than emitting every line', () => {
    const state = createState();
    const bigContent = Array.from({ length: 520 }, (_, i) => `line ${i}`).join('\n');
    applyToolStart(state, { toolName: 'Write', toolArgs: { filePath: '/tmp/big.md', content: bigContent } });
    const finished = applyToolEnd(state, {
      type: 'end',
      toolName: 'Write',
      toolArgs: { filePath: '/tmp/big.md', content: bigContent },
      success: true,
    });
    const diffLines = finished?.diffLines ?? [];
    const addLines = diffLines.filter((l) => l.type === 'add');
    expect(addLines.length).toBeLessThan(520);
    expect(diffLines.at(-1)?.text).toMatch(/more lines truncated/);
  });
});

describe('#3288: relative display paths (server-side, additive to firstArg)', () => {
  it('computes a workspace-relative diffFile when cwd is provided, without changing firstArg', () => {
    const state = createState();
    applyToolStart(
      state,
      { toolName: 'Write', toolArgs: { filePath: '/workspace/src/file.ts', content: 'x' } },
      undefined,
      '/workspace',
    );
    const finished = applyToolEnd(
      state,
      {
        type: 'end',
        toolName: 'Write',
        toolArgs: { filePath: '/workspace/src/file.ts', content: 'x' },
        success: true,
      },
      '/workspace',
    );
    expect(finished?.diffFile).toBe('src/file.ts');
    expect(finished?.firstArg).toBe('/workspace/src/file.ts');
  });

  it('keeps the absolute path when it falls outside the workspace', () => {
    const state = createState();
    applyToolStart(
      state,
      { toolName: 'Write', toolArgs: { filePath: '/etc/hosts', content: 'x' } },
      undefined,
      '/workspace',
    );
    const finished = applyToolEnd(
      state,
      { type: 'end', toolName: 'Write', toolArgs: { filePath: '/etc/hosts', content: 'x' }, success: true },
      '/workspace',
    );
    expect(finished?.diffFile).toBe('/etc/hosts');
  });
});

describe('#3288: parallel same-named tool_end attribution (executionId-first)', () => {
  it('attributes tool_end by executionId, not by "first running with this name"', () => {
    const state = createState();
    applyToolStart(state, { toolName: 'Read', toolArgs: { filePath: 'a.ts' }, executionId: 'exec-a' });
    applyToolStart(state, { toolName: 'Read', toolArgs: { filePath: 'b.ts' }, executionId: 'exec-b' });

    // The SECOND call (exec-b) finishes first. A name-only `findIndex` would close the FIRST
    // matching running entry (exec-a) instead — attributing exec-b's result to exec-a's call.
    const finished = applyToolEnd(state, {
      type: 'end',
      toolName: 'Read',
      toolResultData: 'result-for-b',
      success: true,
      executionId: 'exec-b',
    });

    expect(finished?.executionId).toBe('exec-b');
    expect(finished?.firstArg).toBe('b.ts');
    const stillRunning = state.activeTools.find((t) => t.executionId === 'exec-a');
    expect(stillRunning?.isRunning).toBe(true);
  });
});

describe('an `end` with no matching `start` (CORE-027)', () => {
  // CORE-027 made a crashed tool announce an `end` event, which it never did before. Review asked
  // the right question: `toolName` is set partway through the wrapper's try block, so a throw BEFORE
  // that point emits an `end` with no `start`, and a consumer that assumes strict pairing — an
  // in-flight counter, say — could go negative.
  //
  // It cannot here, and this pins why rather than leaving it to a reading: the lookup requires a
  // RUNNING tool of that name, and finding none it returns null and mutates nothing. The caller
  // (`handleToolExecution`) emits `tool_end` only when this returns a value.
  it('changes nothing and reports nothing finished', () => {
    const state = createState();

    const finished = applyToolEnd(state, {
      type: 'end',
      toolName: 'never-started',
      success: false,
    });

    expect(finished).toBeNull();
    expect(state.activeTools).toEqual([]);
  });

  it('leaves a DIFFERENT running tool untouched', () => {
    // The lookup matches on name, so the case above would also pass against an implementation that
    // closed whatever happened to be running first. This one would not.
    const state = createState();
    applyToolStart(state, { toolName: 'still-running', toolArgs: {} });

    expect(
      applyToolEnd(state, { type: 'end', toolName: 'never-started', success: false }),
    ).toBeNull();
    expect(state.activeTools[0]?.isRunning).toBe(true);
  });
});
