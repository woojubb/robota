/**
 * The frame reader on streams that are over before it starts reading: a stream that is already
 * destroyed or closed never emits `close` again, so the reader itself has to report its end, and
 * must not read a frame off it.
 */
import { once } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { encodeLinkFrame, readLinkFrames } from '../link-stream.js';
import { until } from './harness.js';

function reading(rest?: Uint8Array) {
  const seen = { frames: 0, ends: 0 };
  return {
    seen,
    reading: {
      ...(rest !== undefined ? { rest } : {}),
      maxBytes: () => 64,
      onFrame: () => {
        seen.frames += 1;
      },
      onEnd: () => {
        seen.ends += 1;
      },
    },
  };
}

describe('readLinkFrames on a stream that is already over', () => {
  it('reports the end of a stream that closed before it was read, and reads nothing from it', async () => {
    const stream = new PassThrough();
    stream.destroy();
    await once(stream, 'close');
    const { seen, reading: options } = reading(encodeLinkFrame(Buffer.from('late')));
    readLinkFrames(stream, options);
    await until(() => seen.ends > 0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen).toEqual({ frames: 0, ends: 1 });
  });

  it('reports the end of a stream destroyed whose close has not come yet, once', async () => {
    const stream = new PassThrough();
    stream.destroy();
    const { seen, reading: options } = reading();
    readLinkFrames(stream, options);
    await once(stream, 'close');
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen).toEqual({ frames: 0, ends: 1 });
  });
});
