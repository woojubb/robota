/**
 * Bounded un-acked output buffer for session-resume (REMOTE-013 Stage E4).
 *
 * Holds the tail of outbound `TServerMessage`s that a reconnecting client may not have received, keyed by a
 * monotonic sequence number. On reconnect the client sends `resume{lastSeq}` and the host replays
 * {@link ResumeBuffer.tailAfter}; a periodic `ack{seq}` frees everything up to `seq`. The buffer is bounded by
 * a frame count AND a byte budget (drop-oldest) so a never-acking or gone peer cannot exhaust host memory —
 * and when a client's `lastSeq` predates the oldest retained frame it returns an **overrun** marker so the
 * client does a full refresh rather than accept a silent gap.
 */

import type { TServerMessage } from './ws-protocol.js';

/** One retained frame: its sequence number and the message. */
export interface IBufferedFrame {
  readonly seq: number;
  readonly message: TServerMessage;
}

/** The result of a `tailAfter` — either the ordered replay slice, or an overrun (client must full-refresh). */
export type TResumeTail =
  | { readonly kind: 'tail'; readonly frames: readonly IBufferedFrame[] }
  | { readonly kind: 'overrun' };

export interface IResumeBufferOptions {
  /** Max retained frames (drop-oldest beyond this). Default 512. */
  readonly maxFrames?: number;
  /** Max retained bytes across frames (drop-oldest beyond this). Default 4 MiB. */
  readonly maxBytes?: number;
  /** Serialized size of a message (for the byte budget). Default: JSON length. Injectable for tests. */
  readonly sizeOf?: (message: TServerMessage) => number;
}

const DEFAULT_MAX_FRAMES = 512;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * A monotonic, bounded ring of un-acked frames. Sequence numbers are assigned by {@link append} and never
 * reused; `tailAfter` / `ackThrough` operate over the retained window.
 */
export class ResumeBuffer {
  private readonly frames: IBufferedFrame[] = [];
  private readonly sizes: number[] = []; // parallel to `frames` — retained byte size per frame
  private nextSeq = 1;
  private bytes = 0;

  private readonly maxFrames: number;
  private readonly maxBytes: number;
  private readonly sizeOf: (message: TServerMessage) => number;

  public constructor(options: IResumeBufferOptions = {}) {
    this.maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.sizeOf = options.sizeOf ?? ((m) => JSON.stringify(m).length);
  }

  /** Append a message, assign + return its monotonic seq, and evict oldest frames beyond the bounds. */
  public append(message: TServerMessage): number {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    const size = this.sizeOf(message);
    this.frames.push({ seq, message });
    this.sizes.push(size);
    this.bytes += size;
    this.evict();
    return seq;
  }

  /** Drop all retained frames with `seq <= throughSeq` (the client confirmed receipt up to there). */
  public ackThrough(throughSeq: number): void {
    let drop = 0;
    while (drop < this.frames.length && this.frames[drop].seq <= throughSeq) drop += 1;
    this.removeOldest(drop);
  }

  /**
   * The ordered frames with `seq > lastSeq`. Returns an `overrun` marker when `lastSeq` is older than the
   * oldest retained frame (i.e. some frame after `lastSeq` was already evicted) — the client must full-refresh.
   * `lastSeq` at or beyond the newest seq yields an empty tail (nothing to replay).
   */
  public tailAfter(lastSeq: number): TResumeTail {
    if (this.frames.length === 0) {
      // Nothing retained. Only an overrun if the client is behind the frames we HAVE emitted+evicted.
      return lastSeq >= this.nextSeq - 1 ? { kind: 'tail', frames: [] } : { kind: 'overrun' };
    }
    const oldest = this.frames[0].seq;
    if (lastSeq < oldest - 1) return { kind: 'overrun' };
    return { kind: 'tail', frames: this.frames.filter((f) => f.seq > lastSeq) };
  }

  /** The last seq assigned (0 when nothing has been appended). */
  public get lastSeq(): number {
    return this.nextSeq - 1;
  }

  /** Retained frame count (diagnostics/tests). */
  public get size(): number {
    return this.frames.length;
  }

  private evict(): void {
    let drop = 0;
    let remainingBytes = this.bytes;
    // Evict oldest while over the frame cap, or over the byte cap (but always keep at least the newest frame).
    while (
      this.frames.length - drop > this.maxFrames ||
      (remainingBytes > this.maxBytes && this.frames.length - drop > 1)
    ) {
      remainingBytes -= this.sizes[drop];
      drop += 1;
    }
    this.removeOldest(drop);
  }

  /** The single place that mutates `frames`/`sizes`/`bytes` for removal, so byte accounting can't drift. */
  private removeOldest(count: number): void {
    if (count <= 0) return;
    for (let i = 0; i < count; i += 1) this.bytes -= this.sizes[i] ?? 0;
    this.frames.splice(0, count);
    this.sizes.splice(0, count);
    if (this.frames.length === 0) this.bytes = 0;
  }
}
