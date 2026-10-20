/**
 * The input bridge and close observation a stdio protocol carrier shares.
 *
 * A protocol SDK that reads a stream owns what it reads: closing the SDK connection destroys its
 * source. Handing it the process input directly would let one carrier's `stop()` destroy `process.stdin`
 * for the whole process, so the carrier reads a `PassThrough` bridge fed by the input instead. Piping
 * also makes EOF observable before the SDK starts reading and keeps early frames, with backpressure,
 * until it does.
 *
 * This module only attaches and detaches. What a close or failure means — settle a promise, cancel a
 * startup, end the process — stays with each carrier.
 */

import { PassThrough } from 'node:stream';

import type { Readable, Writable } from 'node:stream';

export interface IStdioCarrierHandlers {
  /** The peer ended its side: `end` or `close` on the input. May fire more than once. */
  readonly onInputClose: () => void;
  /** The output closed. */
  readonly onOutputClose: () => void;
  /** The output failed to accept a write. */
  readonly onOutputError: (error: Error) => void;
}

export interface IStdioCarrier {
  /** Hand this to the protocol SDK in place of the input; destroying it never destroys the input. */
  readonly bridge: PassThrough;
  /** Remove the listeners, unpipe and destroy the bridge. Safe to call again; the streams stay open. */
  release(): void;
}

export function attachStdioCarrier(
  input: Readable,
  output: Writable,
  handlers: IStdioCarrierHandlers,
): IStdioCarrier {
  const bridge = new PassThrough();
  let released = false;
  input.once('end', handlers.onInputClose);
  input.once('close', handlers.onInputClose);
  output.once('close', handlers.onOutputClose);
  output.on('error', handlers.onOutputError);
  input.pipe(bridge);
  return {
    bridge,
    release() {
      if (released) return;
      released = true;
      input.off('end', handlers.onInputClose);
      input.off('close', handlers.onInputClose);
      output.off('close', handlers.onOutputClose);
      output.off('error', handlers.onOutputError);
      input.unpipe(bridge);
      bridge.destroy();
    },
  };
}
