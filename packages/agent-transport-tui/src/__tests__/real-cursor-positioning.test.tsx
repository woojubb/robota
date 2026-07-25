/**
 * CLI-062 — real-terminal-cursor positioning through ink's actual interactive render path.
 *
 * Renders CjkTextInput inside a TransportTUI-shaped harness against a fake TTY stdout
 * (`interactive: true`), then interprets the raw ANSI stream with the same VT logic a terminal
 * emulator (and the OS IME) applies. This is the component-level half of the CLI-062 contract
 * (.design/investigations/2026-07-25-cli-062-ime-cursor-design.md): the hardware cursor must be
 * shown ON the input row at the composition column, track CJK width growth, disappear when the
 * input is unfocused (I4), propagate `undefined` on unmount (I4), and the production code must
 * write NOTHING to the real process streams (the PoC row-accounting lesson, I3).
 *
 * `ROBOTA_IME_CURSOR=1` opts the capability gate in explicitly — the vitest process has no TTY,
 * so the default gate would (correctly) refuse; the opt-in is the supported override.
 */

import { EventEmitter } from 'node:events';

import chalk from 'chalk';
import { Box, Text, render } from 'ink';
import React, { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { interpretVtStream } from './helpers/vt-cursor-interpreter.js';
import CjkTextInput from '../CjkTextInput.js';

const COLS = 60;
const ROWS = 24;
const PROMPT = '> ';

class FakeTtyStdout extends EventEmitter {
  readonly isTTY = true;
  readonly columns = COLS;
  readonly rows = ROWS;
  private chunks: string[] = [];
  write = (chunk: string, callback?: () => void): boolean => {
    this.chunks.push(String(chunk));
    callback?.();
    return true;
  };
  stream(): string {
    return this.chunks.join('');
  }
}

class FakeStdin extends EventEmitter {
  readonly isTTY = true;
  private pending: string | null = null;
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read(): string | null {
    const data = this.pending;
    this.pending = null;
    return data;
  }
  send(data: string): void {
    this.pending = data;
    this.emit('readable');
    this.emit('data', data);
  }
}

function Harness({ focus = true }: { focus?: boolean }): React.ReactElement {
  const [value, setValue] = useState('');
  return (
    <Box flexDirection="column">
      <Text>banner line</Text>
      <Box>
        <Text>{PROMPT}</Text>
        <CjkTextInput value={value} onChange={setValue} availableWidth={COLS - 2} focus={focus} />
      </Box>
      <Text>status line</Text>
    </Box>
  );
}

interface IScenario {
  stdout: FakeTtyStdout;
  stdin: FakeStdin;
  unmount: () => void;
}

function renderScenario(focus?: boolean): IScenario {
  const stdout = new FakeTtyStdout();
  const stdin = new FakeStdin();
  const instance = render(<Harness {...(focus === undefined ? {} : { focus })} />, {
    // Cast: ink wants real process streams; the fakes implement the parts its render loop uses.
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { stdout, stdin, unmount: instance.unmount };
}

/** Ink throttles frames (≤30fps) and React effects settle asynchronously — allow both to flush. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 120));

const INPUT_ROW = 1; // banner is row 0, input row is row 1 in the harness frame

describe('CLI-062 — real cursor positioning (interactive ink render)', () => {
  const ORIGINAL_CHALK_LEVEL = chalk.level;

  beforeAll(() => {
    vi.stubEnv('ROBOTA_IME_CURSOR', '1');
    chalk.level = 3; // make the drawn inverse cursor observable in bytes, so suppression is provable
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    chalk.level = ORIGINAL_CHALK_LEVEL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the hardware cursor on the input row at the composition column and tracks CJK growth', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write');
    const stderrSpy = vi.spyOn(process.stderr, 'write');

    const { stdout, stdin, unmount } = renderScenario();
    await settle();

    stdin.send('안녕');
    await settle();

    const afterTwo = interpretVtStream(stdout.stream(), ROWS, COLS);
    const showsAfterTwo = afterTwo.showEvents;
    expect(showsAfterTwo.length).toBeGreaterThan(0);
    // Every show lands on the input row (never the banner/top region — the crash geometry).
    for (const event of showsAfterTwo) {
      expect(event.row).toBe(INPUT_ROW);
    }
    // Composition column: '> ' (2 cols) + 안녕 (2 wide chars = 4 cols).
    expect(showsAfterTwo.at(-1)).toMatchObject({ row: INPUT_ROW, col: 6 });

    stdin.send('하'); // one more wide char → +2 columns
    await settle();

    const afterThree = interpretVtStream(stdout.stream(), ROWS, COLS);
    expect(afterThree.showEvents.at(-1)).toMatchObject({ row: INPUT_ROW, col: 8 });

    // Drawn-cursor suppression: before the first measurement the fallback legitimately draws the
    // inverse block (I1: no guessed rows), but from the first positioned show onward the hardware
    // cursor and the inverse block must never coexist.
    const firstShowOffset = afterThree.showEvents[0]!.offset;
    expect(stdout.stream().slice(firstShowOffset)).not.toContain('\u001b[7m');

    // I3/PoC lesson: the production path writes NOTHING to the real process streams.
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();

    unmount();
  });

  it('I4: unfocused input never positions the cursor (and keeps the fallback drawn-cursor path off)', async () => {
    const { stdout, stdin, unmount } = renderScenario(false);
    await settle();
    stdin.send('x'); // ignored — not focused
    await settle();

    const vt = interpretVtStream(stdout.stream(), ROWS, COLS);
    expect(vt.showEvents).toEqual([]);
    unmount();
  });

  it('I4: blur withdraws the position (no shows after focus loss) and unmount leaves the cursor visible', async () => {
    const stdout = new FakeTtyStdout();
    const stdin = new FakeStdin();
    const instance = render(<Harness />, {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    await settle();
    stdin.send('안');
    await settle();
    expect(interpretVtStream(stdout.stream(), ROWS, COLS).showEvents.length).toBeGreaterThan(0);

    // Blur: the guard fails → setCursorPosition(undefined) → ink hides the hardware cursor and
    // emits NO further positioned shows (the I4 fallback path).
    instance.rerender(<Harness focus={false} />);
    await settle();
    const afterBlurMark = stdout.stream().length;
    stdin.send('x'); // ignored — not focused; also must not resurrect the cursor
    await settle();
    const blurShows = interpretVtStream(stdout.stream(), ROWS, COLS).showEvents.filter(
      (event) => event.offset >= afterBlurMark,
    );
    expect(blurShows).toEqual([]);

    // Unmount: useCursor's cleanup propagates `undefined`; ink's teardown restores a bare,
    // visible cursor (never a freshly positioned one).
    instance.unmount();
    await settle();
    expect(interpretVtStream(stdout.stream(), ROWS, COLS).visible).toBe(true);
  });
});
