/**
 * SCREEN-2670 — the pre-write park: an owned write path between Ink and the terminal.
 *
 * A diff-based screen reader computes what to speak from successive terminal snapshots. In
 * screen-reader mode Ink runs UNTHROTTLED (`ink.js:193`), so commits land back to back and a reader
 * that samples between two of them sees a torn or already-overwritten region. The park separates
 * commits IN TIME so a snapshot can fall between them. It does not move the cursor: every frame Ink
 * writes already begins with `eraseLines`, which ends in `cursorLeft`, so column zero is where the
 * frame starts anyway (CLI-062 invariant I3 — no cursor sequence is written here).
 *
 * THE UNIT IS A COMMIT, NOT A CHUNK. One commit in the mode is up to four `write()` calls in one
 * synchronous run (`ink.js:371-412`): synchronized-output begin, `erase + staticOutput`, the frame,
 * synchronized-output end. Parking each would pay the interval three times and leave the erased
 * region on screen between the erase and the frame — the torn state the park exists to prevent. So
 * the chunks of one synchronous run form ONE batch (closed on `process.nextTick`), parked once in
 * front and released contiguously.
 *
 * WHAT IS NEVER PARKED:
 * - the first batch of a session (there is no earlier commit to separate it from);
 * - a batch with no printable content — Ink's empty-string barrier (`ink.js:588`, `:647`), an OSC
 *   133 mark, a bare control sequence — which still queues BEHIND anything pending so order holds;
 * - a batch stamped with the echo flag: the composer's own key handler arms it for text-mutating
 *   keys only, it is read when the batch OPENS and carried on it (so a keystroke queued behind a
 *   parked reply keeps its exemption), and it expires on `setImmediate` whether or not a batch took
 *   it, so a keystroke that commits nothing cannot un-park a later transcript batch.
 *
 * DROPPING IS NEVER SILENT. When commits arrive faster than the park drains, the newest pending
 * printable batch supersedes the older waiting one — a superseded full redraw has no reader value
 * and an unbounded queue is a memory leak on a fast stream. A batch carrying the barrier is never
 * dropped, and every dropped chunk's callback is still settled, so `waitUntilExit()` resolves.
 */

import { sanitizeTerminalText } from './sanitize-terminal-text.js';

import type { IScreenReaderPacingPort } from './screen-reader-pacing-context.js';

/** Ink's own fallbacks when the stream reports no size. */
const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

type TWriteCallback = (error?: Error | null) => void;

/**
 * What Ink 7.1.1 touches on the stream it is given (`ink.js`, `log-update.js`): the write, the
 * dimensions, the TTY flag, the resize listener pair, and the writable-state probes.
 */
export type TParkedStdoutSource = Pick<
  NodeJS.WriteStream,
  | 'write'
  | 'columns'
  | 'rows'
  | 'isTTY'
  | 'destroyed'
  | 'writable'
  | 'writableEnded'
  | 'writableLength'
  | 'writableNeedDrain'
  | 'on'
  | 'off'
>;

export interface ICreateParkedStdoutOptions {
  stdout: TParkedStdoutSource;
  /** Milliseconds between the previous printable release and the next parked one. */
  preparkMs: number;
  /** Injected clock for tests. Defaults to `Date.now`. */
  now?: () => number;
}

interface IChunk {
  text: string;
  callback: TWriteCallback | undefined;
}

interface IBatch {
  chunks: IChunk[];
  /** Read at formation, never at release. */
  echo: boolean;
  printable: boolean;
  /** Ink's `write('', cb)` — never coalesced away. */
  barrier: boolean;
  first: boolean;
}

export interface IParkedStdout {
  /** The stream to hand Ink as `stdout`. One stable object: Ink keys its instance map by it. */
  asInkStdout(): NodeJS.WriteStream;
  /** The composer's key handler arms this for a text-mutating key. Expires on `setImmediate`. */
  armEchoRelease(): void;
  /** Write through the same ordered path — for the OSC 133 marks, which are positional. */
  write(chunk: string | Uint8Array, callback?: TWriteCallback): boolean;
  /** Release everything still queued, in order and without further parking; resolves when written. */
  flush(): Promise<void>;
}

/** The members Ink reads from `options.stdout`, narrowed as `TInkStdinSurface` narrows stdin. */
type TInkStdoutSurface = TParkedStdoutSource;

function toText(chunk: string | Uint8Array): string {
  return typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
}

/** Printable = something a reader could speak: visible text after every escape is stripped. */
function isPrintable(text: string): boolean {
  return sanitizeTerminalText(text).trim().length > 0;
}

class ParkedStdout implements TInkStdoutSurface {
  private readonly source: TParkedStdoutSource;
  private readonly preparkMs: number;
  private readonly now: () => number;
  private open: IBatch | undefined;
  private readonly queue: IBatch[] = [];
  private timer: NodeJS.Timeout | undefined;
  private lastPrintableReleaseAt: number | undefined;
  private hasReleasedFirst = false;
  private echoArmed = false;
  private echoExpiryScheduled = false;
  private flushing = false;
  private drainWaiters: Array<() => void> = [];

  constructor(options: ICreateParkedStdoutOptions) {
    this.source = options.stdout;
    this.preparkMs = options.preparkMs;
    this.now = options.now ?? Date.now;
    this.on = ((...args: Parameters<NodeJS.WriteStream['on']>) =>
      this.source.on(...args)) as NodeJS.WriteStream['on'];
    this.off = ((...args: Parameters<NodeJS.WriteStream['off']>) =>
      this.source.off(...args)) as NodeJS.WriteStream['off'];
  }

  // ── the surface Ink reads ──────────────────────────────────────────────────────────────────

  get columns(): number {
    return this.source.columns ?? DEFAULT_COLUMNS;
  }

  get rows(): number {
    return this.source.rows ?? DEFAULT_ROWS;
  }

  get isTTY(): boolean {
    return this.source.isTTY ?? false;
  }

  get destroyed(): boolean {
    return this.source.destroyed ?? false;
  }

  get writable(): boolean {
    return this.source.writable ?? true;
  }

  get writableEnded(): boolean {
    return this.source.writableEnded ?? false;
  }

  get writableLength(): number {
    return this.source.writableLength ?? 0;
  }

  get writableNeedDrain(): boolean {
    return this.source.writableNeedDrain ?? false;
  }

  // Ink registers and removes its `resize` listener through these and discards the return value.
  readonly on: NodeJS.WriteStream['on'];
  readonly off: NodeJS.WriteStream['off'];

  /**
   * The write is deferred, so the boolean is the source's CURRENT backpressure state — what the
   * same call would have returned a moment ago. Ink does not read it; a caller that does is told
   * the truth about the stream it is ultimately writing to.
   */
  write(
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | TWriteCallback,
    maybeCallback?: TWriteCallback,
  ): boolean {
    const callback = typeof encodingOrCallback === 'function' ? encodingOrCallback : maybeCallback;
    const text = toText(chunk);
    let batch = this.open;
    if (batch === undefined) {
      const opened: IBatch = {
        chunks: [],
        echo: this.echoArmed,
        printable: false,
        barrier: false,
        first: !this.hasReleasedFirst && this.queue.length === 0,
      };
      batch = opened;
      this.open = opened;
      // One synchronous run = one batch. nextTick drains before the check phase, so a batch opened
      // in the turn that armed the echo flag always closes before the flag's setImmediate expiry.
      process.nextTick(() => this.close(opened));
    }
    batch.chunks.push({ text, callback });
    if (text.length === 0) batch.barrier = true;
    else if (!batch.printable && isPrintable(text)) batch.printable = true;
    return !this.writableNeedDrain;
  }

  // ── the owned-writer surface ──────────────────────────────────────────────────────────────

  asInkStdout(): NodeJS.WriteStream {
    const surface: TInkStdoutSurface = this;
    return surface as NodeJS.WriteStream;
  }

  armEchoRelease(): void {
    this.echoArmed = true;
    if (this.echoExpiryScheduled) return;
    this.echoExpiryScheduled = true;
    setImmediate(() => {
      this.echoArmed = false;
      this.echoExpiryScheduled = false;
    });
  }

  flush(): Promise<void> {
    this.flushing = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pump();
    if (this.open === undefined && this.queue.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.drainWaiters.push(resolve);
    });
  }

  // ── batching and release ──────────────────────────────────────────────────────────────────

  private close(batch: IBatch): void {
    if (this.open !== batch) return;
    this.open = undefined;
    if (this.isParked(batch)) this.supersede();
    this.queue.push(batch);
    this.pump();
  }

  private isParked(batch: IBatch): boolean {
    return this.preparkMs > 0 && !batch.first && batch.printable && !batch.echo && !this.flushing;
  }

  /** Drop every waiting parked printable batch that carries no barrier; settle its callbacks. */
  private supersede(): void {
    const kept: IBatch[] = [];
    for (const waiting of this.queue) {
      if (this.isParked(waiting) && !waiting.barrier) {
        for (const chunk of waiting.chunks) {
          if (chunk.callback !== undefined) process.nextTick(chunk.callback, null);
        }
      } else {
        kept.push(waiting);
      }
    }
    this.queue.splice(0, this.queue.length, ...kept);
  }

  private pump(): void {
    // Always recompute from the head: a superseded head leaves a stale timer behind, and the batch
    // now at the head may be a control-only one that must not wait on it.
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    while (this.queue.length > 0) {
      const head = this.queue[0] as IBatch;
      if (this.isParked(head)) {
        const due = (this.lastPrintableReleaseAt ?? 0) + this.preparkMs;
        const wait = due - this.now();
        if (wait > 0) {
          this.timer = setTimeout(() => {
            this.timer = undefined;
            this.pump();
          }, wait);
          this.timer.unref?.();
          return;
        }
      }
      this.queue.shift();
      this.release(head);
    }
    if (this.open === undefined) {
      const waiters = this.drainWaiters;
      this.drainWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  private release(batch: IBatch): void {
    this.hasReleasedFirst = true;
    for (const chunk of batch.chunks) {
      this.source.write(chunk.text, chunk.callback);
    }
    if (batch.printable) this.lastPrintableReleaseAt = this.now();
  }
}

/** Build the owned write path. Constructed only when the mode is on and `preparkMs > 0`. */
export function createParkedStdout(options: ICreateParkedStdoutOptions): IParkedStdout {
  return new ParkedStdout(options);
}

/** The port the render tree publishes: arming and the positional write, bound to one proxy. */
export function toPacingPort(parked: IParkedStdout): IScreenReaderPacingPort {
  return {
    armEchoRelease: () => parked.armEchoRelease(),
    write: (text) => {
      parked.write(text);
    },
  };
}
