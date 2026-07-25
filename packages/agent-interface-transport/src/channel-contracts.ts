/**
 * Payload-agnostic channel contracts (TRANS-001).
 *
 * The SSOT for carrying **arbitrary payloads** over a transport connection, alongside — and
 * independent of — the text-agent protocol profile (`text_delta`/`submit`/…) that
 * `agent-transport-protocol` owns. A consumer declares a named channel with its own event
 * vocabulary and, optionally, opaque binary frames; the transport routes those frames without ever
 * inspecting or interpreting the bytes.
 *
 * Content-neutral by construction: nothing here knows about audio, files, images, or any other
 * payload domain. Domain adapters (a voice app's STT/TTS bridge, a file uploader) are assembled by
 * the consumer ON TOP of these contracts — never inside the library (ROOM-001 principle).
 *
 * Layering (CMD-004 precedent — contracts below, per-environment behavior above):
 *
 *   agent-interface-transport   ← THIS FILE: the channel contracts
 *   agent-transport-protocol    ← the pure wire codec for these frames
 *   agent-transport-ws          ← the carrier: routes binary WS frames to channels, text WS
 *                                 frames to the text-agent protocol profile
 */

import type { TUniversalValue } from '@robota-sdk/agent-core';

/**
 * An **opaque** binary frame. `payload` is bytes the transport neither inspects nor interprets —
 * the carrier only reads the envelope (`channel`, `seq`) to route and order it.
 */
export interface IBinaryFrame {
  readonly kind: 'binary';
  /** The declared channel this frame belongs to. */
  readonly channel: string;
  /**
   * Sender-assigned, monotonically increasing per-channel sequence number. The receiver reassembles
   * a chunked payload by `seq`, so ordering does not depend on delivery order.
   */
  readonly seq: number;
  /** The opaque bytes. Never parsed by the transport. */
  readonly payload: Uint8Array;
}

/**
 * A structured, consumer-declared event frame. `event` is one of the names the channel's
 * {@link IChannelDescriptor} declared; `payload` is JSON-serializable data.
 */
export interface IChannelEventFrame<TPayload = TUniversalValue> {
  readonly kind: 'event';
  /** The declared channel this frame belongs to. */
  readonly channel: string;
  /** Shares the channel's `seq` space with {@link IBinaryFrame}, so interleaved order is total. */
  readonly seq: number;
  /** The declared event name. */
  readonly event: string;
  /** The event payload. */
  readonly payload: TPayload;
}

/** Either frame kind carried on a payload-agnostic channel. Discriminated by `kind`. */
export type TChannelFrame = IBinaryFrame | IChannelEventFrame;

/**
 * A consumer's event vocabulary for one channel: event name → payload type. Declaring it is what
 * makes {@link IPayloadChannel.sendEvent} / {@link IPayloadChannel.onEvent} type-safe without
 * forking the agent wire protocol.
 */
export type TChannelEventMap = Readonly<Record<string, TUniversalValue>>;

/** The declaration a consumer registers to open a channel. */
export interface IChannelDescriptor<TEvents extends TChannelEventMap = TChannelEventMap> {
  /**
   * Channel name, unique per transport. Must be non-empty and at most 255 UTF-8 bytes (the wire
   * envelope's channel-name field).
   */
  readonly name: string;
  /** The event names this channel carries. Traffic for an undeclared name is a protocol error. */
  readonly events: readonly (keyof TEvents & string)[];
  /** Opt in to opaque binary frames. When absent/false, binary traffic on this channel is rejected. */
  readonly binary?: boolean;
}

/** A registered channel handle — the consumer's send/receive surface. */
export interface IPayloadChannel<TEvents extends TChannelEventMap = TChannelEventMap> {
  /** The declaration this handle was opened with. */
  readonly descriptor: IChannelDescriptor<TEvents>;
  /** Send a declared event. Throws for an event name the descriptor did not declare. */
  sendEvent<K extends keyof TEvents & string>(event: K, payload: TEvents[K]): void;
  /** Send opaque bytes. Throws unless the descriptor set `binary: true`. */
  sendBinary(payload: Uint8Array): void;
  /** Subscribe to one declared event. Returns an unsubscribe function. */
  onEvent<K extends keyof TEvents & string>(
    event: K,
    handler: (payload: TEvents[K], frame: IChannelEventFrame<TEvents[K]>) => void,
  ): () => void;
  /** Subscribe to inbound opaque frames. Returns an unsubscribe function. */
  onBinary(handler: (frame: IBinaryFrame) => void): () => void;
  /** Close the channel: handlers stop receiving and the name becomes re-registerable. */
  close(): void;
}

/**
 * A transport that can carry consumer-declared channels alongside its own protocol profile.
 * Implemented by a transport adapter (e.g. `WsTransport`); the agent text protocol becomes one
 * profile ON this carrier rather than being the carrier itself.
 */
export interface IPayloadChannelHost {
  /** Open a channel. Throws when the name is already registered on this host. */
  registerChannel<TEvents extends TChannelEventMap>(
    descriptor: IChannelDescriptor<TEvents>,
  ): IPayloadChannel<TEvents>;
}

/**
 * The result of routing an inbound frame. An explicit union — a frame that cannot be routed
 * (unknown channel, undeclared event, binary on a text-only channel, malformed envelope) surfaces
 * as a stated error the carrier reports to the peer, never a silent drop.
 */
export type TChannelReceiveResult =
  | { readonly ok: true; readonly frame: TChannelFrame }
  | { readonly ok: false; readonly error: string };
