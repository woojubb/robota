/**
 * SCREEN-1993 TC-04 — the reverse prompt-history search overlay inside the input area.
 *
 * The source is an async iterable the test releases block by block, so "the first block renders
 * before the second is yielded" and "cancel aborts the loader" are observed, not assumed.
 */
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import InputArea from '../InputArea.js';
import { ScreenReaderProvider } from '../screen-reader-context.js';

import type { IInputAreaHistorySearch } from '../hooks/useInputAreaHistorySearch.js';
import type {
  IPromptHistoryBlock,
  IPromptHistoryEntry,
  IPromptHistorySource,
} from '@robota-sdk/agent-interface-session';

const CTRL_R = '\x12';
const CTRL_S = '\x13';
const CTRL_E = '\x05';
const ESCAPE = '\x1b';
const ENTER = '\r';
const ARROW_DOWN = '\x1b[B';
const SUBMIT_SETTLE_MS = 150;

async function tick(ms = 25): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function entry(text: string, sessionId = 'other', project = '/elsewhere'): IPromptHistoryEntry {
  return { at: '2026-01-01T00:00:00.000Z', sessionId, project, text };
}

/** A source whose blocks are released by the test, recording opens and abort signals. */
function gatedSource(blocks: readonly IPromptHistoryBlock[]): {
  readonly source: IPromptHistorySource;
  readonly release: () => void;
  readonly reads: number;
  readonly aborted: () => boolean;
  readonly opens: () => number;
} {
  let opens = 0;
  let resolveNext: (() => void) | undefined;
  let signal: AbortSignal | undefined;
  const source: IPromptHistorySource = {
    async *read(options) {
      opens += 1;
      signal = options.signal;
      for (const block of blocks) {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
        if (options.signal.aborted) return;
        yield block;
      }
    },
  };
  return {
    source,
    release: () => resolveNext?.(),
    reads: blocks.length,
    aborted: () => signal?.aborted === true,
    opens: () => opens,
  };
}

function renderWith(
  source: IPromptHistorySource,
  options: {
    readonly screenReader?: boolean;
    readonly onOpenChange?: (open: boolean) => void;
  } = {},
): ReturnType<typeof render> & { readonly onSubmit: ReturnType<typeof vi.fn> } {
  const onSubmit = vi.fn();
  const historySearch: IInputAreaHistorySearch = {
    source,
    sessionId: 's-current',
    project: '/here',
    onOpenChange: options.onOpenChange,
  };
  const rendered = render(
    <ScreenReaderProvider enabled={options.screenReader === true}>
      <InputArea onSubmit={onSubmit} isDisabled={false} historySearch={historySearch} />
    </ScreenReaderProvider>,
  );
  return { ...rendered, onSubmit };
}

describe('SCREEN-1993 TC-04: the history-search overlay', () => {
  it('opens on ctrl+r, starts one loader, and renders the first block before the second lands', async () => {
    const gate = gatedSource([
      { entries: [entry('deploy the canary to eu-west', 's-current', '/here')], skippedLines: 1 },
      { entries: [entry('rotate the staging secrets')], skippedLines: 0 },
    ]);
    const opened: boolean[] = [];
    const { stdin, lastFrame, unmount } = renderWith(gate.source, {
      onOpenChange: (open) => opened.push(open),
    });
    await tick();
    stdin.write('dra');
    await tick();
    stdin.write(CTRL_R);
    await tick();
    expect(gate.opens()).toBe(1);
    expect(opened).toEqual([true]);
    expect(lastFrame()).toContain('(reverse-i-search)');
    expect(lastFrame()).toContain('scope: all');
    expect(lastFrame()).toContain('loading…');

    gate.release();
    await tick();
    expect(lastFrame()).toContain('deploy the canary to eu-west');
    expect(lastFrame()).not.toContain('rotate the staging secrets');
    expect(lastFrame()).toContain('1 unreadable line skipped');

    gate.release();
    await tick();
    expect(lastFrame()).toContain('rotate the staging secrets');
    expect(lastFrame()).not.toContain('loading…');
    expect(gate.opens()).toBe(1);
    unmount();
  });

  it('a source with a synchronous body still renders the first block before the second lands', async () => {
    // `NodePromptHistoryFile.read` is an async generator whose body is `readSync` all the way down:
    // between two blocks there is only a microtask. Without a macrotask yield in the loader, Ink's
    // throttled write never runs between publishes and the user sees the whole file at once.
    const source: IPromptHistorySource = {
      async *read() {
        yield { entries: [entry('newest block prompt')], skippedLines: 0 };
        yield { entries: [entry('older block prompt')], skippedLines: 0 };
      },
    };
    const { stdin, frames, lastFrame, unmount } = renderWith(source);
    await tick();
    stdin.write(CTRL_R);
    await tick(100);
    expect(lastFrame()).toContain('older block prompt');
    const firstBlockFrame = frames.find(
      (frame) => frame.includes('newest block prompt') && !frame.includes('older block prompt'),
    );
    expect(firstBlockFrame).toBeDefined();
    unmount();
  });

  it('narrows as the query is typed with the match marked, and enter inserts without submitting', async () => {
    const gate = gatedSource([
      {
        entries: [
          entry('deploy the canary to eu-west'),
          entry('tidy the changelog headings'),
          entry('redeploy after the deploy hook fails'),
        ],
        skippedLines: 0,
      },
    ]);
    const { stdin, lastFrame, onSubmit, unmount } = renderWith(gate.source);
    await tick();
    stdin.write(CTRL_R);
    gate.release();
    await tick();
    stdin.write('deploy');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('query: deploy');
    expect(frame).toContain('[deploy]');
    expect(frame).not.toContain('tidy the changelog headings');
    expect(frame).toContain('2 matches');

    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(lastFrame()).not.toContain('(reverse-i-search)');
    expect(lastFrame()).toContain('redeploy after the deploy hook fails');
    expect(onSubmit).not.toHaveBeenCalled();
    unmount();
  });

  it('ctrl+e submits the highlighted match through the normal submit path', async () => {
    const gate = gatedSource([{ entries: [entry('rotate the staging secrets')], skippedLines: 0 }]);
    const { stdin, lastFrame, onSubmit, unmount } = renderWith(gate.source);
    await tick();
    stdin.write(CTRL_R);
    gate.release();
    await tick();
    stdin.write('rotate');
    await tick();
    stdin.write(CTRL_E);
    await tick();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('rotate the staging secrets');
    expect(lastFrame()).not.toContain('(reverse-i-search)');
    unmount();
  });

  it('escape mid-load aborts the loader and leaves the draft byte-identical', async () => {
    const gate = gatedSource([
      { entries: [entry('a')], skippedLines: 0 },
      { entries: [entry('b')], skippedLines: 0 },
    ]);
    const opened: boolean[] = [];
    const { stdin, lastFrame, onSubmit, unmount } = renderWith(gate.source, {
      onOpenChange: (open) => opened.push(open),
    });
    await tick();
    const draft = 'third draft: keep me byte-identical  ';
    stdin.write(draft);
    await tick();
    stdin.write(CTRL_R);
    gate.release();
    await tick();
    stdin.write('zzz');
    await tick();
    expect(lastFrame()).toContain('query: zzz');
    expect(lastFrame()).toContain('loading…');
    stdin.write(ESCAPE);
    await tick();
    expect(gate.aborted()).toBe(true);
    expect(opened).toEqual([true, false]);
    expect(lastFrame()).not.toContain('(reverse-i-search)');
    expect(lastFrame()).toContain(draft.trimEnd());
    expect(onSubmit).not.toHaveBeenCalled();
    // The draft is submitted unchanged: what the composer holds is what it held before ctrl+r.
    stdin.write(ENTER);
    await tick(50);
    expect(onSubmit).toHaveBeenCalledWith(draft.trim());
    unmount();
  });

  it('ctrl+s cycles the scope and the session scope is the live prompt list', async () => {
    const gate = gatedSource([
      {
        entries: [entry('stored elsewhere'), entry('stored here', 'other', '/here')],
        skippedLines: 0,
      },
    ]);
    const { stdin, lastFrame, unmount } = renderWith(gate.source);
    await tick();
    for (const prompt of ['typed this session', 'another prompt', 'typed this session']) {
      stdin.write(prompt);
      await tick();
      stdin.write(ENTER);
      // Past the deferred-submit window, so the next prompt starts from an empty composer.
      await tick(SUBMIT_SETTLE_MS);
    }
    stdin.write(CTRL_R);
    gate.release();
    await tick();
    expect(lastFrame()).toContain('stored elsewhere');
    stdin.write(CTRL_S);
    await tick();
    expect(lastFrame()).toContain('scope: session');
    expect(lastFrame()).toContain('typed this session');
    // Collapsed to the newest occurrence in the session scope too.
    expect((lastFrame() ?? '').split('typed this session').length - 1).toBe(1);
    expect(lastFrame()).not.toContain('stored elsewhere');
    stdin.write(CTRL_S);
    await tick();
    expect(lastFrame()).toContain('scope: project');
    expect(lastFrame()).toContain('stored here');
    expect(lastFrame()).not.toContain('stored elsewhere');
    stdin.write(CTRL_S);
    await tick();
    expect(lastFrame()).toContain('scope: all');
    unmount();
  });

  it('keeps a multi-line prompt on one row with a visible newline glyph', async () => {
    const source: IPromptHistorySource = {
      async *read() {
        yield { entries: [entry('first line\nsecond line')], skippedLines: 0 };
      },
    };
    const { stdin, lastFrame, unmount } = renderWith(source);
    await tick();
    stdin.write(CTRL_R);
    await tick();
    expect(lastFrame()).toContain('first line↵second line');
    unmount();
  });

  it('renders a read error instead of an empty list', async () => {
    const source: IPromptHistorySource = {
      // eslint-disable-next-line require-yield -- the failure is the whole behaviour under test.
      async *read() {
        throw new Error('EACCES: permission denied');
      },
    };
    const { stdin, lastFrame, unmount } = renderWith(source);
    await tick();
    stdin.write(CTRL_R);
    await tick();
    expect(lastFrame()).toContain('History could not be read: EACCES: permission denied');
    unmount();
  });

  it('in screen-reader mode the rows are numbered and blocks are published only at load end', async () => {
    const gate = gatedSource([
      { entries: [entry('first block prompt')], skippedLines: 0 },
      { entries: [entry('second block prompt')], skippedLines: 0 },
    ]);
    const { stdin, lastFrame, unmount } = renderWith(gate.source, { screenReader: true });
    await tick();
    stdin.write(CTRL_R);
    gate.release();
    await tick();
    expect(lastFrame()).not.toContain('first block prompt');
    gate.release();
    await tick();
    expect(lastFrame()).toContain('1. first block prompt');
    expect(lastFrame()).toContain('2. second block prompt');
    // Digits are query text, not a selection.
    stdin.write('2');
    await tick();
    expect(lastFrame()).toContain('query: 2');
    expect(lastFrame()).toContain('no match');
    unmount();
  });
});
