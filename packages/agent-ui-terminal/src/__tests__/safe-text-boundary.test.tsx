/**
 * #2222: the SafeText boundary, asserted against the BYTES Ink writes to a tty — not against
 * `lastFrame()`. Measured on PR #2212: Ink itself strips OSC 52 / OSC 0 / CSI / DCS / APC from a
 * frame and passes SGR, OSC 8 and a bare CR, so a frame assertion is green whether or not the code
 * sanitizes. Only the stream a real terminal would receive tells the two apart.
 *
 * The raw-`Text` case below is REQUIRED to leak: it is what proves the detector can answer "yes".
 */

import { Writable } from 'node:stream';

import { Text as RawInkText, render } from 'ink';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { SafeText, Text } from '../SafeText.js';

import type { ReactElement } from 'react';

/** OSC 8 hyperlink (Ink passes it through) and a bare CR — the two markers a frame cannot show. */
const OSC8 = ']8;;https://evil.exampleclick]8;;';
const POISON = `before${OSC8}\rafter`;

/** A stream that claims to be a tty, so Ink writes what a terminal would receive. */
function createTtyCapture(): { stdout: NodeJS.WriteStream; bytes: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const stdout = Object.assign(stream, {
    isTTY: true,
    columns: 80,
    rows: 24,
  }) as unknown as NodeJS.WriteStream;
  return { stdout, bytes: () => chunks.join('') };
}

async function renderToTty(element: ReactElement): Promise<string> {
  const capture = createTtyCapture();
  const instance = render(element, { stdout: capture.stdout, patchConsole: false });
  await new Promise((resolve) => setTimeout(resolve, 20));
  instance.unmount();
  return capture.bytes();
}

describe('SafeText boundary (#2222)', () => {
  it('a raw ink Text render LEAKS the markers to the tty stream (detector proof)', async () => {
    const bytes = await renderToTty(<RawInkText>{POISON}</RawInkText>);
    expect(bytes).toContain(']8;;https://evil.example');
    expect(bytes).toContain('before');
  });

  it('SafeText removes the markers from the same payload, keeping the visible text', async () => {
    const bytes = await renderToTty(<SafeText>{POISON}</SafeText>);
    expect(bytes).not.toContain('evil.example');
    expect(bytes).not.toContain(']8;;');
    expect(bytes).toContain('before');
    expect(bytes).toContain('after');
  });

  it('the `Text` alias call sites use is the boundary, and nested children are covered', async () => {
    const bytes = await renderToTty(
      <Text>
        {'label: '}
        <Text bold>{POISON}</Text>
        {[POISON, 42]}
      </Text>,
    );
    expect(bytes).not.toContain('evil.example');
    expect(bytes).toContain('42');
  });
});
