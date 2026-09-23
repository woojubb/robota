/**
 * CLI-2004 TC-10 — the input area in screen-reader mode.
 *
 * Two things, and they fail for the same reason. The hand-drawn rules above and below the input are
 * repainted with the line, so a reader hears a wall of dashes on every keystroke; and a word
 * deletion leaves a reader announcing what REMAINS, which is precisely not the information wanted.
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import InputArea from '../InputArea.js';
import { formatDeletionAnnouncement } from '../input-area-rules.js';
import { ScreenReaderProvider } from '../screen-reader-context.js';

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function renderInput(enabled: boolean): ReturnType<typeof render> {
  return render(
    <ScreenReaderProvider enabled={enabled}>
      <InputArea onSubmit={vi.fn()} isDisabled={false} />
    </ScreenReaderProvider>,
  );
}

describe('TC-10: the input area chrome', () => {
  it('renders no rule line and no border in the mode', async () => {
    const { lastFrame, unmount } = renderInput(true);
    await tick();
    const frame = lastFrame() ?? '';
    unmount();

    expect(frame).not.toContain('─');
    expect(frame).not.toMatch(/[╭╮╰╯│┌┐└┘]/u);
    expect(frame).toContain('Type a message');
  });

  it('still renders the rules when the mode is off', async () => {
    const { lastFrame, unmount } = renderInput(false);
    await tick();
    const frame = lastFrame() ?? '';
    unmount();

    expect(frame).toContain('─');
  });
});

describe('TC-10: the deletion announcement', () => {
  it('prints `[deleted: <word>]` exactly once after a word deletion', async () => {
    const { stdin, lastFrame, unmount } = renderInput(true);
    await tick();

    for (const char of 'hello world') {
      stdin.write(char);
    }
    await tick();
    // Ctrl+W — the word delete.
    stdin.write('\x17');
    await tick();

    const frame = lastFrame() ?? '';
    unmount();

    const announcement = formatDeletionAnnouncement('world');
    expect(frame).toContain(announcement);
    expect(frame.split(announcement).length - 1).toBe(1);
  });

  it('announces the whole line for a line deletion', async () => {
    const { stdin, lastFrame, unmount } = renderInput(true);
    await tick();

    for (const char of 'abc') {
      stdin.write(char);
    }
    await tick();
    // Ctrl+U — the line delete.
    stdin.write('\x15');
    await tick();

    const frame = lastFrame() ?? '';
    unmount();

    expect(frame).toContain(formatDeletionAnnouncement('abc'));
  });

  it('announces nothing when the mode is off', async () => {
    const { stdin, lastFrame, unmount } = renderInput(false);
    await tick();

    for (const char of 'hello world') {
      stdin.write(char);
    }
    await tick();
    stdin.write('\x17');
    await tick();

    const frame = lastFrame() ?? '';
    unmount();

    expect(frame).not.toContain('[deleted:');
  });
});
