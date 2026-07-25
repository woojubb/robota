/**
 * Payload-agnostic channel registry (TRANS-001) — the transport-side half of
 * {@link IPayloadChannelHost}.
 *
 * Owns the multiplexing the carrier needs and nothing else: which channels exist, what each one
 * declared, per-channel outbound `seq`, the attached connection sinks, and inbound routing. It is
 * completely blind to payload semantics — a channel carrying audio, a file, or app events is the
 * same object to this class.
 *
 * Every rejection is EXPLICIT: an undeclared event, binary traffic on a text-only channel, or a
 * frame for an unregistered channel comes back as a stated error the carrier reports to the peer.
 * Nothing is silently dropped or defaulted.
 */

import {
  decodeChannelFrame,
  encodeBinaryFrame,
  encodeChannelEventFrame,
} from '@robota-sdk/agent-transport-protocol';

import type {
  IBinaryFrame,
  IChannelDescriptor,
  IChannelEventFrame,
  IPayloadChannel,
  IPayloadChannelHost,
  TChannelEventMap,
  TChannelReceiveResult,
} from '@robota-sdk/agent-interface-transport';

/** Delivers an encoded frame to one attached connection. */
export type TChannelSink = (frame: Uint8Array) => void;

type TBinaryHandler = (frame: IBinaryFrame) => void;
/**
 * Storage type for a consumer's event handler. `never` parameters make every concrete
 * `(payload: TEvents[K], frame: IChannelEventFrame<TEvents[K]>) => void` assignable to it, so the
 * per-channel handler sets stay heterogeneous without an `unknown` double-cast. The declared-event
 * check at both `onEvent` and `receive` is what keeps the erased types honest at runtime.
 */
type TEventHandler = (payload: never, frame: never) => void;

/** Per-channel mutable state. Kept private to the registry — consumers only see `IPayloadChannel`. */
interface IChannelState {
  readonly descriptor: IChannelDescriptor;
  readonly declaredEvents: ReadonlySet<string>;
  readonly eventHandlers: Map<string, Set<TEventHandler>>;
  readonly binaryHandlers: Set<TBinaryHandler>;
  seq: number;
  open: boolean;
}

export class PayloadChannelRegistry implements IPayloadChannelHost {
  private readonly channels = new Map<string, IChannelState>();
  private readonly sinks = new Set<TChannelSink>();

  /**
   * Attach a connection. Every frame a channel sends is fanned out to all attached sinks; the
   * returned function detaches (call it on socket close).
   */
  addSink(sink: TChannelSink): () => void {
    this.sinks.add(sink);
    return (): void => {
      this.sinks.delete(sink);
    };
  }

  registerChannel<TEvents extends TChannelEventMap>(
    descriptor: IChannelDescriptor<TEvents>,
  ): IPayloadChannel<TEvents> {
    if (this.channels.has(descriptor.name)) {
      throw new Error(`Channel "${descriptor.name}" is already registered on this transport`);
    }
    const state: IChannelState = {
      descriptor: descriptor as IChannelDescriptor,
      declaredEvents: new Set<string>(descriptor.events),
      eventHandlers: new Map(),
      binaryHandlers: new Set(),
      seq: 0,
      open: true,
    };
    this.channels.set(descriptor.name, state);
    return this.createHandle<TEvents>(descriptor, state);
  }

  /**
   * Route one inbound encoded frame to its channel's handlers. The result states exactly what
   * happened so the carrier can answer the peer (a `protocol_error`) instead of dropping it.
   */
  receive(bytes: Uint8Array): TChannelReceiveResult {
    const decoded = decodeChannelFrame(bytes);
    if (!decoded.ok) return decoded;

    const { frame } = decoded;
    const state = this.channels.get(frame.channel);
    if (!state || !state.open) {
      return { ok: false, error: `No channel registered for "${frame.channel}"` };
    }

    if (frame.kind === 'binary') {
      if (state.descriptor.binary !== true) {
        return {
          ok: false,
          error: `Channel "${frame.channel}" did not declare binary payload support`,
        };
      }
      for (const handler of [...state.binaryHandlers]) handler(frame);
      return { ok: true, frame };
    }

    if (!state.declaredEvents.has(frame.event)) {
      return {
        ok: false,
        error: `Channel "${frame.channel}" did not declare event "${frame.event}"`,
      };
    }
    const handlers = state.eventHandlers.get(frame.event);
    if (handlers) {
      for (const handler of [...handlers]) handler(frame.payload as never, frame as never);
    }
    return { ok: true, frame };
  }

  /** Fan one encoded frame out to every attached connection. */
  private broadcast(frame: Uint8Array): void {
    for (const sink of [...this.sinks]) sink(frame);
  }

  /** Assert the channel is still open before any send/subscribe. */
  private static assertOpen(state: IChannelState): void {
    if (!state.open) throw new Error(`Channel "${state.descriptor.name}" is closed`);
  }

  private createHandle<TEvents extends TChannelEventMap>(
    descriptor: IChannelDescriptor<TEvents>,
    state: IChannelState,
  ): IPayloadChannel<TEvents> {
    return {
      descriptor,

      sendEvent: <K extends keyof TEvents & string>(event: K, payload: TEvents[K]): void => {
        PayloadChannelRegistry.assertOpen(state);
        if (!state.declaredEvents.has(event)) {
          throw new Error(`Channel "${descriptor.name}" did not declare event "${event}"`);
        }
        const seq = state.seq;
        state.seq += 1;
        this.broadcast(
          encodeChannelEventFrame({
            kind: 'event',
            channel: descriptor.name,
            seq,
            event,
            payload,
          }),
        );
      },

      sendBinary: (payload: Uint8Array): void => {
        PayloadChannelRegistry.assertOpen(state);
        if (descriptor.binary !== true) {
          throw new Error(`Channel "${descriptor.name}" did not declare binary payload support`);
        }
        const seq = state.seq;
        state.seq += 1;
        this.broadcast(
          encodeBinaryFrame({ kind: 'binary', channel: descriptor.name, seq, payload }),
        );
      },

      onEvent: <K extends keyof TEvents & string>(
        event: K,
        handler: (payload: TEvents[K], frame: IChannelEventFrame<TEvents[K]>) => void,
      ): (() => void) => {
        PayloadChannelRegistry.assertOpen(state);
        if (!state.declaredEvents.has(event)) {
          throw new Error(`Channel "${descriptor.name}" did not declare event "${event}"`);
        }
        const set = state.eventHandlers.get(event) ?? new Set<TEventHandler>();
        const typed: TEventHandler = handler;
        set.add(typed);
        state.eventHandlers.set(event, set);
        return (): void => {
          set.delete(typed);
        };
      },

      onBinary: (handler: (frame: IBinaryFrame) => void): (() => void) => {
        PayloadChannelRegistry.assertOpen(state);
        state.binaryHandlers.add(handler);
        return (): void => {
          state.binaryHandlers.delete(handler);
        };
      },

      close: (): void => {
        state.open = false;
        state.eventHandlers.clear();
        state.binaryHandlers.clear();
        this.channels.delete(descriptor.name);
      },
    };
  }
}
