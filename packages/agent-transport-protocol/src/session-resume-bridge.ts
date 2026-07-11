/**
 * Persistent session-resume bridge for the reconnectable WebRTC path (REMOTE-013 Stage E4).
 *
 * Created ONCE per remote session and OUTLIVES individual data channels. It subscribes to the session's
 * events exactly once, stamps every outbound `TServerMessage` with a **monotonic `seq` that is continuous
 * across channel drops**, and retains the un-acked tail in a {@link ResumeBuffer}. The data channel is a
 * SWAPPABLE sink:
 *
 * - `attach(sink)` — set the current sink (a new channel after a reconnect). Does NOT auto-replay; replay is
 *   driven by the client's `resume`.
 * - `detach()` — clear the sink but KEEP buffering, so output produced while no channel is attached (the gap)
 *   is captured and replayable.
 * - `onClientMessage(data)` — `resume{lastSeq}` replays the buffered tail (or `resume_gap` on overrun); `ack{seq}`
 *   frees the buffer; everything else routes to the session (reusing the shared `handleClientMessage`).
 * - `dispose()` — unsubscribe (host reconnect-window ceiling / teardown).
 *
 * This is the fix for the placement defect: because the seq counter + buffer live here (not in the per-channel
 * `createWsHandler`), `seq` does not reset when a reconnect builds a new channel, and gap output is not lost.
 * The WS localhost path does NOT use this bridge — it keeps `createWsHandler` unchanged.
 */

import { ResumeBuffer, type IResumeBufferOptions } from './resume-buffer.js';
import { handleClientMessage, parseClientMessage, subscribeSessionEvents } from './ws-handler.js';

import type { TSeqServerMessage, TServerMessage } from './ws-protocol.js';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

/** The current channel sink — receives a serialized JSON frame to put on the wire. */
export type TResumeSink = (data: string) => void;

/** Options for {@link SessionResumeBridge.attach}. */
export interface IAttachOptions {
  /**
   * REMOTE-013 E4: on a RECONNECT, HOLD live sink-forwarding until the client's `resume` has replayed the
   * buffered tail — otherwise a live frame emitted between attach and the inbound `resume` would leapfrog the
   * gap frames on the wire, and the client's seq-dedup would then discard the (older, lower-seq) gap. Every
   * live event is already appended to the buffer, so holding loses nothing; `replay()` flushes in order and
   * un-holds. First-pair attach does NOT hold (the client starts at seq 0, frames arrive in order).
   */
  readonly awaitResume?: boolean;
}

export interface ISessionResumeBridgeOptions {
  readonly session: IInteractiveSession;
  readonly buffer?: IResumeBufferOptions;
}

export class SessionResumeBridge {
  private readonly session: IInteractiveSession;
  private readonly buffer: ResumeBuffer;
  private readonly unsubscribe: () => void;
  private sink?: TResumeSink;
  private disposed = false;
  /** REMOTE-013 E4: while true, live emits are buffered but NOT forwarded — released by `replay()` on reconnect. */
  private holding = false;

  public constructor(options: ISessionResumeBridgeOptions) {
    this.session = options.session;
    this.buffer = new ResumeBuffer(options.buffer);
    // ONE subscription for the whole session — outlives every channel. Every event → seq-stamped + buffered.
    this.unsubscribe = subscribeSessionEvents(this.session, (message) => this.emit(message));
  }

  /** Set the current channel sink (on connect / reconnect). Live messages reach the client; replay is `resume`-driven. */
  public attach(sink: TResumeSink, options: IAttachOptions = {}): void {
    if (this.disposed) return;
    this.sink = sink;
    // On a reconnect, hold live forwarding until `resume` flushes the buffered tail (avoids the live-vs-replay race).
    this.holding = options.awaitResume === true;
  }

  /** Clear the sink (channel drop). Buffering continues so gap output is retained for the next `resume`. */
  public detach(): void {
    this.sink = undefined;
  }

  /** Route one inbound channel frame: `resume`/`ack` handled here; everything else → the session. */
  public onClientMessage(data: string): void {
    if (this.disposed) return;
    const msg = parseClientMessage(data, (m) => this.emit(m));
    if (!msg) return;
    if (msg.type === 'resume') {
      this.replay(msg.lastSeq);
      return;
    }
    if (msg.type === 'ack') {
      this.buffer.ackThrough(msg.seq);
      return;
    }
    // Session control/query/background/prompt-response — responses funnel back through `emit` (seq'd + buffered).
    handleClientMessage(this.session, (m) => this.emit(m), msg);
  }

  /** Unsubscribe from the session (host reconnect-window ceiling / teardown). Idempotent. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sink = undefined;
    this.unsubscribe();
  }

  /** Diagnostics/tests: the last seq assigned. */
  public get lastSeq(): number {
    return this.buffer.lastSeq;
  }

  /** Stamp a seq, retain in the buffer, and forward to the current sink — UNLESS holding for a reconnect replay. */
  private emit(message: TServerMessage): void {
    if (this.disposed) return;
    const seq = this.buffer.append(message);
    if (this.holding) return; // buffered only; `replay()` will flush it in order and release the hold
    this.send({ ...message, seq } as TSeqServerMessage);
  }

  /**
   * Replay the buffered tail after `lastSeq` (or `resume_gap` on overrun), then RELEASE the reconnect hold so
   * subsequent live frames flow in order behind the flushed gap.
   */
  private replay(lastSeq: number): void {
    const tail = this.buffer.tailAfter(lastSeq);
    if (tail.kind === 'overrun') {
      this.rawSend(JSON.stringify({ type: 'resume_gap' }));
      this.holding = false; // client will full-refresh via get-messages; let live frames flow
      return;
    }
    for (const frame of tail.frames) {
      this.send({ ...frame.message, seq: frame.seq } as TSeqServerMessage);
    }
    this.holding = false; // gap flushed in order — resume live forwarding
  }

  private send(message: TSeqServerMessage): void {
    this.rawSend(JSON.stringify(message));
  }

  private rawSend(data: string): void {
    try {
      this.sink?.(data);
    } catch {
      // The channel is closing/closed — the frame stays in the buffer for the next resume.
    }
  }
}
