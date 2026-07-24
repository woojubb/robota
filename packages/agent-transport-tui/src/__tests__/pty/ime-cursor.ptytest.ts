/**
 * CLI-062 — PTY regression for real-terminal-cursor positioning (the OS-IME evidence).
 *
 * Runs the BUILT robota binary in a real pseudo-terminal and interprets the raw ANSI stream the
 * way a terminal emulator (and the OS IME) does. Two geometries from the implementation contract
 * (.design/investigations/2026-07-25-cli-062-ime-cursor-design.md):
 *
 *  - 24-row pty: while typing CJK, every `ESC[?25h` emitted after boot lands ON the input row at
 *    the composition column — never the top region (the historical hardcoded-y:0 crash geometry).
 *  - 5-row pty: the live frame fills the viewport (ink's fullscreen path, bottom-anchor
 *    off-by-one) — invariant I2 must refuse to position: ZERO cursor-show sequences after boot.
 *
 * Assertions only cover the post-boot composition window: boot may legitimately show the cursor
 * (spinners etc.), and teardown restores visibility — both are outside the invariant.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';
import { interpretVtStream } from '../helpers/vt-cursor-interpreter.js';

import type { IPtySession } from './pty-driver.js';

const COLS = 80;
const PROMPT_PLACEHOLDER = /Type a message or \/help/;
/** Let ink's throttled (≤30fps) frame writes flush after the last keystroke. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 400));

describe('CLI-062 — IME hardware-cursor positioning through a real PTY', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'robota-pty-ime-'));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('24-row pty: every post-boot cursor show lands on the input row at the composition column', async () => {
    const rows = 24;
    session = spawnTui({ projectDir, homeDir: join(projectDir, 'home'), cols: COLS, rows });
    await session.waitFor(PROMPT_PLACEHOLDER);
    await flush();

    const bootMark = session.raw().length;
    await session.sendKeys('안녕');
    await session.waitFor(/안녕/);
    await flush();

    const raw = session.raw();
    const vt = interpretVtStream(raw, rows, COLS);
    const compositionShows = vt.showEvents.filter((event) => event.offset >= bootMark);

    // The feature must actually fire (this line is the pre-change RED):
    expect(compositionShows.length).toBeGreaterThan(0);

    // Locate the input row on the final screen ('> ' prompt followed by the typed value).
    const inputRow = vt.screen.findIndex((line) => line.includes('> 안녕'));
    expect(inputRow).toBeGreaterThanOrEqual(0);

    for (const event of compositionShows) {
      // Never the top region (the Terminal.app SIGSEGV geometry), always the input row.
      expect(event.row).toBe(inputRow);
    }

    // Composition column: prompt col + '> ' (2) + 안녕 (4 display columns).
    const promptCol = vt.screen[inputRow]!.indexOf('> ');
    expect(compositionShows.at(-1)!.col).toBe(promptCol + 2 + 4);
  }, 60_000);

  it('5-row pty (frame ≥ viewport, I2): zero cursor-show sequences during composition', async () => {
    const rows = 5;
    session = spawnTui({ projectDir, homeDir: join(projectDir, 'home'), cols: COLS, rows });
    await session.waitFor(PROMPT_PLACEHOLDER);
    await flush();

    const bootMark = session.raw().length;
    await session.sendKeys('안녕');
    await session.waitFor(/안녕/);
    await flush();

    const vt = interpretVtStream(session.raw(), rows, COLS);
    const compositionShows = vt.showEvents.filter((event) => event.offset >= bootMark);
    expect(compositionShows).toEqual([]);
  }, 60_000);
});
