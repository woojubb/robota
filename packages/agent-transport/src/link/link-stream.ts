/**
 * The owner link on a byte stream: after the request line, length-prefixed binary frames.
 *
 * Each frame is a 4-byte big-endian length and that many bytes. Every frame is bounded by what may
 * come next (a hello, a challenge, a proof, a sealed frame), and the bound is checked as soon as the
 * length arrives, so a peer can never make an end buffer more than one frame it is allowed to send.
 * Chunks are kept as they arrive and joined once per frame, so a large frame costs one copy.
 */
import { Buffer } from 'node:buffer';
import type { Duplex } from 'node:stream';

import { LINK_REQUEST_LINE } from './link-request.js';

export const LENGTH_PREFIX_BYTES = 4;

/** One frame: its length, then its bytes. */
export function encodeLinkFrame(payload: Uint8Array): Buffer {
  const prefix = Buffer.alloc(LENGTH_PREFIX_BYTES);
  prefix.writeUInt32BE(payload.length);
  return Buffer.concat([prefix, payload]);
}

/** The request line and the first frame, written together so the endpoint can route both at once. */
export function encodeLinkOpening(hello: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(LINK_REQUEST_LINE, 'utf8'), encodeLinkFrame(hello)]);
}

/** Collects stream chunks and hands out whole frames within the bound the caller gives. */
class LinkFrameReader {
  #chunks: Buffer[] = [];
  #length = 0;

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    this.#chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    this.#length += chunk.length;
  }

  /** The next whole frame, or `undefined` until it has arrived; throws when one is announced over `maxBytes`. */
  next(maxBytes: number): Buffer | undefined {
    if (this.#length < LENGTH_PREFIX_BYTES) return undefined;
    if (this.#chunks[0]!.length < LENGTH_PREFIX_BYTES) this.#join();
    const length = this.#chunks[0]!.readUInt32BE(0);
    if (length > maxBytes) throw new RangeError('A frame was announced over its bound.');
    if (this.#length < LENGTH_PREFIX_BYTES + length) return undefined;
    const all = this.#join();
    const end = LENGTH_PREFIX_BYTES + length;
    const payload = Buffer.from(all.subarray(LENGTH_PREFIX_BYTES, end));
    const rest = all.subarray(end);
    this.#chunks = rest.length > 0 ? [rest] : [];
    this.#length = rest.length;
    return payload;
  }

  #join(): Buffer {
    const all =
      this.#chunks.length === 1 ? this.#chunks[0]! : Buffer.concat(this.#chunks, this.#length);
    this.#chunks = [all];
    return all;
  }
}

export interface IFrameReading {
  /** The bytes after the request line that arrived with it. */
  readonly rest?: Uint8Array;
  /** The largest frame allowed next; asked before each frame. */
  readonly maxBytes: () => number;
  /** One whole frame. May end the stream; nothing more is read once it has. */
  readonly onFrame: (frame: Buffer) => void;
  /** The stream ended, errored, or sent a frame over its bound. Called once. */
  readonly onEnd: () => void;
}

/**
 * Reads frames off `stream` until it ends; a frame over its bound destroys the stream. A stream that
 * is already destroyed or closed reads nothing and ends on the next tick.
 */
export function readLinkFrames(stream: Duplex, reading: IFrameReading): void {
  const reader = new LinkFrameReader();
  let ended = false;
  const end = (): void => {
    if (ended) return;
    ended = true;
    reading.onEnd();
  };
  const drain = (): void => {
    try {
      for (
        let frame = reader.next(reading.maxBytes());
        frame !== undefined;
        frame = reader.next(reading.maxBytes())
      ) {
        if (stream.destroyed) return;
        reading.onFrame(frame);
        if (stream.destroyed) return;
      }
    } catch {
      // A frame over its bound, or a handler that failed: either way this link is over.
      stream.destroy();
    }
  };
  stream.on('data', (chunk: Buffer | string) => {
    // A stream decoding to text has already lost the frames' bytes.
    if (typeof chunk === 'string') {
      stream.destroy();
      return;
    }
    reader.push(chunk);
    drain();
  });
  stream.on('error', () => stream.destroy());
  stream.once('close', end);
  stream.once('end', () => stream.destroy());
  if (reading.rest !== undefined) reader.push(reading.rest);
  drain();
  stream.resume();
  // A stream that is over before it is read emits no `close` to wait for, and a link must still end.
  if (stream.destroyed) process.nextTick(end);
}
