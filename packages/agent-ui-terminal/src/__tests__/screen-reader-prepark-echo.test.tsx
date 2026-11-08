/**
 * SCREEN-2670 TC-10 — the echo exemption FIRES through the real render path.
 *
 * TC-03 arms the flag by hand, which proves the queue honours a stamp and nothing about whether
 * anything ever sets one. This drives a keystroke through Ink's own input path into the composed
 * tree — keybindings, the pacing context, the composer's key handler — with the proxy as Ink's
 * stdout, and asserts BOTH halves: the keystroke's commit leaves unparked, and the next commit that
 * is not a keystroke (a prop change from outside the composer, and Enter — whose commit appends the
 * prompt line) is parked. A proxy that stamped everything would pass the first half and fail the
 * second, which is why they sit in one test.
 */

import { EventEmitter } from 'node:events';

import { Box, render, Text } from 'ink';
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import CjkTextInput from '../CjkTextInput.js';
import { KeybindingsProvider } from '../keybindings/keybindings-context.js';
import { parseKeybindingsDocument } from '../keybindings/keybinding-registry.js';
import { ScreenReaderPacingProvider } from '../screen-reader-pacing-context.js';
import { createParkedStdout } from '../screen-reader-stdout.js';

import type { IKeybindingsSource } from '../keybindings/node-keybindings-source.js';
import type { IScreenReaderPacingPort } from '../screen-reader-pacing-context.js';
import type { TParkedStdoutSource } from '../screen-reader-stdout.js';

const PARK_MS = 400;

class FakeTtyStdout extends EventEmitter {
  readonly isTTY = true;
  readonly columns = 80;
  readonly rows = 24;
  readonly destroyed = false;
  readonly writable = true;
  readonly writableEnded = false;
  readonly writableLength = 0;
  readonly writableNeedDrain = false;
  readonly frames: Array<{ text: string; at: number }> = [];
  write = (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    const callback = rest.find((argument) => typeof argument === 'function') as
      ((error?: Error | null) => void) | undefined;
    this.frames.push({ text: String(chunk), at: Date.now() });
    callback?.(null);
    return true;
  };
  asSource(): TParkedStdoutSource {
    return this as unknown as TParkedStdoutSource;
  }
  textSince(index: number): string {
    return this.frames
      .slice(index)
      .map((frame) => frame.text)
      .join('');
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

function source(): IKeybindingsSource {
  const parsed = parseKeybindingsDocument(
    JSON.stringify({ version: 1, bindings: {} }),
    '/tmp/keybindings.json',
  );
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  return {
    filePath: '/tmp/keybindings.json',
    start: async () => undefined,
    isStarted: () => true,
    ensureFile: async () => '/tmp/keybindings.json',
    getSnapshot: () => parsed.snapshot,
    subscribe: () => () => undefined,
    dispose: () => undefined,
  };
}

function Harness({
  banner,
  onSubmit,
}: {
  banner: string;
  onSubmit: (value: string) => void;
}): React.ReactElement {
  const [value, setValue] = useState('');
  return (
    <Box flexDirection="column">
      <Text>{banner}</Text>
      <Box>
        <Text>{'> '}</Text>
        <CjkTextInput
          value={value}
          onChange={setValue}
          onSubmit={(submitted) => {
            // Like the real composer: submitting clears the line, so the commit repaints.
            setValue('');
            onSubmit(submitted);
          }}
          keybindingContext="chat-input"
        />
      </Box>
    </Box>
  );
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** In screen-reader mode Ink linearises each Text node; compare visible characters only. */
const visible = (text: string): string =>
  // eslint-disable-next-line no-control-regex -- stripping the escapes IS the point here
  text.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, '').replace(/\s+/g, ' ');

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

describe('TC-10: a keystroke through the composed tree is released unparked; a non-composer commit is parked', () => {
  it('echo leaves at once, a banner change and Enter each wait out the interval', async () => {
    const stdout = new FakeTtyStdout();
    const stdin = new FakeStdin();
    const parked = createParkedStdout({ stdout: stdout.asSource(), preparkMs: PARK_MS });
    const port: IScreenReaderPacingPort = {
      armEchoRelease: () => parked.armEchoRelease(),
      write: (text) => {
        parked.write(text);
      },
    };
    const submitted: string[] = [];
    const tree = (banner: string): React.ReactElement => (
      <KeybindingsProvider source={source()}>
        <ScreenReaderPacingProvider port={port}>
          <Harness banner={banner} onSubmit={(value) => submitted.push(value)} />
        </ScreenReaderPacingProvider>
      </KeybindingsProvider>
    );
    const instance = render(tree('banner 1'), {
      stdout: parked.asInkStdout(),
      stdin: stdin as unknown as NodeJS.ReadStream,
      isScreenReaderEnabled: true,
      // Ink treats a CI environment as non-interactive and defers every frame to unmount; the
      // park only exists for interactive terminals, so say so explicitly (as the real-cursor
      // suite does) rather than let the runner's CI variable decide what is under test.
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    unmount = instance.unmount;

    // First frames: the first batch is never parked; let the mount settle past one interval.
    await sleep(PARK_MS + 100);
    expect(stdout.textSince(0)).toContain('banner 1');

    // A keystroke: its echo must be on the underlying stream well inside the interval.
    const beforeKey = stdout.frames.length;
    stdin.send('hey');
    await sleep(80);
    expect(visible(stdout.textSince(beforeKey))).toContain('hey');

    // A commit that is not a keystroke, arriving inside the interval after the echo: parked until
    // the interval since that last printable release has elapsed, then released.
    const beforeBanner = stdout.frames.length;
    instance.rerender(tree('banner 2'));
    await sleep(80);
    expect(visible(stdout.textSince(beforeBanner))).not.toContain('banner 2');
    await sleep(PARK_MS);
    expect(visible(stdout.textSince(beforeBanner))).toContain('banner 2');

    // Enter runs through the same key handler and must NOT arm: arriving right after the banner's
    // release, the submit commit is parked like any other transcript commit.
    const beforeEnter = stdout.frames.length;
    stdin.send('\r');
    await sleep(80);
    expect(submitted).toEqual(['hey']);
    expect(stdout.frames.length).toBe(beforeEnter);
    await sleep(PARK_MS);
    expect(stdout.frames.length).toBeGreaterThan(beforeEnter);
  }, 10_000);
});
