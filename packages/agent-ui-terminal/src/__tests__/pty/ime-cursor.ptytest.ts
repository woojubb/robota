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
 *
 * The second describe block drives four boundary representatives through the real binary. The full
 * terminal/override matrix remains exhaustive in terminal-capabilities.test.ts; process startup is
 * reserved for supported-default, Terminal.app-default-off, force-on, and kill-switch boundaries.
 */

import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';
import {
  REPRESENTATIVE_IME_PTY_CELLS,
  TERMINAL_PROFILES,
  cellLabel,
  expectedImeCursorEnabled,
  profileEnv,
} from '../helpers/terminal-profiles.js';
import { interpretVtStream } from '../helpers/vt-cursor-interpreter.js';

import type { IPtySession } from './pty-driver.js';
import type { ICursorShowEvent } from '../helpers/vt-cursor-interpreter.js';

const COLS = 80;
const PROMPT_PLACEHOLDER = /Type a message or \/help/;
const COMPOSITION = '안녕';
/** `안녕` occupies 4 display columns; the prompt adds `> `. */
const COMPOSITION_WIDTH = 4;
/** Let ink's throttled (≤30fps) frame writes flush after the last keystroke. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 400));

interface IProbeResult {
  /** Cursor shows emitted after boot — the composition window the OS IME would act on. */
  compositionShows: ICursorShowEvent[];
  /** Screen row holding `> 안녕`, or -1 when the composition never rendered. */
  inputRow: number;
  /** Column of the `> ` prompt on the input row, or -1. */
  promptCol: number;
}

/**
 * Boot the built binary in a pty of the given geometry, type CJK, and report the cursor shows the
 * terminal would have acted on. Shared by the original two cases and by every matrix cell.
 */
async function probe(
  projectDir: string,
  rows: number,
  env: Record<string, string>,
  register: (session: IPtySession) => void,
): Promise<IProbeResult> {
  const session = spawnTui({
    projectDir,
    homeDir: join(projectDir, 'home'),
    cols: COLS,
    rows,
    env,
  });
  register(session);
  await session.waitFor(PROMPT_PLACEHOLDER);
  await flush();

  const bootMark = session.raw().length;
  await session.sendKeys(COMPOSITION);
  await session.waitFor(new RegExp(COMPOSITION));
  await flush();

  const vt = interpretVtStream(session.raw(), rows, COLS);
  const inputRow = vt.screen.findIndex((line) => line.includes(`> ${COMPOSITION}`));
  return {
    compositionShows: vt.showEvents.filter((event) => event.offset >= bootMark),
    inputRow,
    promptCol: inputRow < 0 ? -1 : vt.screen[inputRow]!.indexOf('> '),
  };
}

/** Every post-boot show sits on the input row at the composition column (the positive contract). */
function expectPositionedOnInputRow(result: IProbeResult): void {
  expect(result.compositionShows.length).toBeGreaterThan(0);
  expect(result.inputRow).toBeGreaterThanOrEqual(0);
  for (const event of result.compositionShows) {
    // Never the top region (the Terminal.app SIGSEGV geometry), always the input row.
    expect(event.row).toBe(result.inputRow);
  }
  expect(result.compositionShows.at(-1)!.col).toBe(result.promptCol + 2 + COMPOSITION_WIDTH);
}

describe('CLI-062 — IME hardware-cursor positioning through a real PTY', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'robota-pty-ime-')));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('24-row pty: every post-boot cursor show lands on the input row at the composition column', async () => {
    const result = await probe(projectDir, 24, {}, (s) => (session = s));
    expectPositionedOnInputRow(result);
  }, 60_000);

  it('5-row pty (frame ≥ viewport, I2): zero cursor-show sequences during composition', async () => {
    const result = await probe(projectDir, 5, {}, (s) => (session = s));
    expect(result.compositionShows).toEqual([]);
  }, 60_000);
});

/**
 * Representative terminal boundaries, re-runnable through the real binary.
 *
 * PROVES, per cell: the built binary's observable cursor contract under exactly the environment
 * that terminal exports — positioned on the input row when the capability gate says yes, and no
 * cursor shown at all when it says no (Terminal.app's default-off I5 branch, and the
 * `ROBOTA_IME_CURSOR=0` kill switch).
 *
 * DOES NOT PROVE, for a `documented` row: anything about that emulator's own rendering, its
 * pre-edit display, or its OS IME. Terminal.app's historical Korean-IME SIGSEGV in particular is
 * an Apple-side defect that can only be re-checked on macOS; it stays off by default (I5) until
 * someone runs the macOS cells. tmux is additionally driven as a REAL emulator in
 * ime-cursor-tmux.ptytest.ts, where the emulator reports its own cursor position back.
 */
describe('CLI-062 terminal matrix — observable cursor contract per terminal', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'robota-pty-ime-matrix-')));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  for (const cell of REPRESENTATIVE_IME_PTY_CELLS) {
    const profile = TERMINAL_PROFILES.find((candidate) => candidate.id === cell.profileId);
    if (!profile) {
      throw new Error(`Unknown representative terminal profile: ${cell.profileId}`);
    }
    const { override } = cell;
    const enabled = expectedImeCursorEnabled(profile, override);
    const verdict = enabled ? 'positions on the input row' : 'never shows the cursor';

    it(`${cellLabel(profile, override)} → ${verdict}`, async () => {
      const env = profileEnv(profile, override);

      const wide = await probe(projectDir, 24, env, (s) => (session = s));
      if (!enabled) {
        expect(wide.compositionShows).toEqual([]);
        return;
      }
      expectPositionedOnInputRow(wide);
      await session?.disposeAsync();
      session = undefined;

      // I2, checked wherever the gate would otherwise allow positioning: a frame that fills the
      // viewport is never positioned into, however capable the terminal is. (For a gated-off
      // cell the 24-row probe above already proves nothing is ever shown.)
      const narrow = await probe(projectDir, 5, env, (s) => (session = s));
      expect(narrow.compositionShows).toEqual([]);
    }, 90_000);
  }
});
