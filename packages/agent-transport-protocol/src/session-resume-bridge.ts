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

import { createOutboundDelivery } from './outbound-delivery.js';
import { ResumeBuffer, type IResumeBufferOptions } from './resume-buffer.js';
import { handleClientMessage, parseClientMessage } from './ws-handler.js';
import { subscribeSessionEvents } from './ws-session-events.js';

import type { TOutboundDeliver } from './outbound-delivery.js';
import type { IProtocolSession } from './protocol-session.js';
import type { TSeqServerMessage, TServerMessage } from './ws-protocol.js';
import type { TDriverId } from '@robota-sdk/agent-interface-session';

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
  /** Sink/carrier-owned failure lifecycle for this attachment only. */
  readonly onDeliveryError: (error: Error, event: string) => void;
}

export interface ISessionResumeBridgeOptions {
  readonly session: IProtocolSession;
  readonly buffer?: IResumeBufferOptions;
  /** REMOTE-014 E5: the SERVER-ASSIGNED driver id for this surface, injected into inbound submit/command/prompt-response. */
  readonly driverId?: TDriverId;
}

export class SessionResumeBridge {
  private readonly session: IProtocolSession;
  private readonly buffer: ResumeBuffer;
  private driverId?: TDriverId;
  private readonly unsubscribe: () => void;
  private onDeliveryError?: IAttachOptions['onDeliveryError'];
  /**
   * ARCH-030: the attachment's outbound boundary — and the only reference this class keeps to the current
   * channel, which is why `dispose()` goes through `detach()` rather than clearing a separate field.
   * Built per `attach` because a boundary LATCHES on its first failure, so a fresh one is exactly what
   * un-latches the session for the next channel. It holds the only try/catch on the frame path.
   */
  private outbound?: TOutboundDeliver;
  /**
   * The session-lifetime entry every frame takes — event fan-out AND every reply to an inbound frame —
   * before it is seq-stamped and buffered by {@link emit}. Distinct from {@link outbound}, which is the
   * per-attachment exit to the current channel; this one outlives channels because the subscription does.
   *
   * It guards the BUFFERING step, not a carrier, and it latches for the life of the session on purpose:
   * the failure it is placed against is the buffer refusing a frame on capacity, and a resume buffer that
   * cannot accept frames cannot honour a later `resume` either, so there is nothing a reconnect recovers.
   * That is the opposite of {@link outbound}, where the next channel IS the recovery — the two scopes
   * differ because the failures do. (A per-frame serialization failure would leave the buffer intact, but
   * such a frame is undeliverable on every carrier, since each one stringifies it too; it is reported and
   * the carrier torn down, never silently dropped.)
   */
  private readonly emitBoundary: TOutboundDeliver;
  private disposed = false;
  /** REMOTE-013 E4: while true, live emits are buffered but NOT forwarded — released by `replay()` on reconnect. */
  private holding = false;

  public constructor(options: ISessionResumeBridgeOptions) {
    this.session = options.session;
    this.buffer = new ResumeBuffer(options.buffer);
    this.driverId = options.driverId;
    // ONE subscription for the whole session — outlives every channel. Every event → seq-stamped + buffered.
    // CMD-004 Stage D: `ui_intent` is requester-routed against the LATE-BOUND driver id (bound by
    // `setDriverId` after pairing) — routing happens BEFORE buffering, so a foreign surface's intent
    // consumes no seq and can never leak through a later `resume` replay.
    //
    // ARCH-030: built through the factory, never cast — the brand is only worth having if this class
    // does not spell its way around it. `emit` buffers and then hands the stamped frame to whatever
    // boundary is currently ATTACHED, so it does not itself throw on a carrier failure; this boundary
    // exists so that if it ever did, the failure would be reported rather than escaping the session's
    // event listener.
    this.emitBoundary = createOutboundDelivery(
      (message) => this.emit(message),
      (error, event) => this.reportDeliveryError(error, event),
    );
    this.unsubscribe = subscribeSessionEvents(this.session, this.emitBoundary, {
      getSurfaceDriverId: () => this.driverId,
    });
  }

  /** Set the current channel sink (on connect / reconnect). Live messages reach the client; replay is `resume`-driven. */
  public attach(sink: TResumeSink, options: IAttachOptions): void {
    if (this.disposed) return;
    this.onDeliveryError = options.onDeliveryError;
    this.outbound = createOutboundDelivery(
      (message) => sink(JSON.stringify(message)),
      (error, event) => this.reportDeliveryError(error, event),
    );
    // On a reconnect, hold live forwarding until `resume` flushes the buffered tail (avoids the live-vs-replay race).
    this.holding = options.awaitResume === true;
  }

  /** Clear the sink (channel drop). Buffering continues so gap output is retained for the next `resume`. */
  public detach(): void {
    this.outbound = undefined;
    this.onDeliveryError = undefined;
  }

  /**
   * REMOTE-014 E5: bind the SERVER-ASSIGNED driver id (the E3 `deviceId`) once the peer pairs — the bridge
   * injects it into every subsequent inbound submit/command/prompt-response for co-drive attribution.
   */
  public setDriverId(driverId: TDriverId): void {
    this.driverId = driverId;
  }

  /** Route one inbound channel frame: `resume`/`ack` handled here; everything else → the session. */
  public onClientMessage(data: string): void {
    if (this.disposed) return;
    const msg = parseClientMessage(data, this.emitBoundary);
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
    // REMOTE-014 E5: inject the server-assigned driver id (submit/prompt-response attribution).
    handleClientMessage(this.session, this.emitBoundary, msg, this.driverId);
  }

  /** Unsubscribe from the session (host reconnect-window ceiling / teardown). Idempotent. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Through `detach`, not a field assignment: the boundary's closure is what holds the channel, so
    // clearing anything else released nothing and left teardown documented but not performed.
    this.detach();
    this.unsubscribe();
  }

  /** Diagnostics/tests: the last seq assigned. */
  public get lastSeq(): number {
    return this.buffer.lastSeq;
  }

  /**
   * Stamp a seq, retain in the buffer, and forward to the current sink — UNLESS holding for a reconnect replay.
   *
   * ARCH-030: the `buffer.append` happens BEFORE the boundary, deliberately. The boundary latches on its
   * first failure and drops everything after it, so a frame appended afterwards would be lost — appending
   * first means a dropped frame is still in the un-acked tail and still replays on the next `resume`.
   */
  private emit(message: TServerMessage): void {
    if (this.disposed) return;
    const seq = this.buffer.append(message);
    if (this.holding) return; // buffered only; `replay()` will flush it in order and release the hold
    this.deliverFrame({ ...message, seq } as TSeqServerMessage);
  }

  /**
   * Replay the buffered tail after `lastSeq` (or `resume_gap` on overrun), then RELEASE the reconnect hold so
   * subsequent live frames flow in order behind the flushed gap.
   *
   * A failing sink reports ONCE across the whole tail: the boundary latches on the first failure and every
   * remaining frame is dropped silently. Those frames stay un-acked in the buffer and replay on the next
   * attachment. Before ARCH-030 the single report was a side effect of `detach()` running mid-loop; now it
   * is the boundary's stated contract.
   */
  private replay(lastSeq: number): void {
    const tail = this.buffer.tailAfter(lastSeq);
    if (tail.kind === 'overrun') {
      // `resume_gap` is neither stamped nor buffered: the client answers it with a full `get-messages`
      // refresh, so there is nothing for it to resume from.
      this.deliverFrame({ type: 'resume_gap' });
      this.holding = false; // client will full-refresh via get-messages; let live frames flow
      return;
    }
    for (const frame of tail.frames) {
      this.deliverFrame({ ...frame.message, seq: frame.seq } as TSeqServerMessage);
    }
    this.holding = false; // gap flushed in order — resume live forwarding
  }

  /** The ONE outbound exit from this class. No frame reaches the sink except through the attachment's boundary. */
  private deliverFrame(message: TServerMessage): void {
    this.outbound?.(message);
  }

  /** Detach the failed sink but retain the frame, then notify its attachment owner. */
  private reportDeliveryError(error: Error, event: string): void {
    const onDeliveryError = this.onDeliveryError;
    this.detach();
    try {
      onDeliveryError?.(error, event);
    } catch {
      // Carrier diagnostics cannot corrupt the retained buffer or the committed operation.
    }
  }
}
