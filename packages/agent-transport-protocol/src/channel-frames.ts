/**
 * Payload-agnostic channel frame codec (TRANS-001).
 *
 * The single place that knows the channel envelope. Pure and transport-neutral: a WebSocket binary
 * frame, a WebRTC data-channel message, or any other byte carrier can use it unchanged. It NEVER
 * interprets a binary body — that is the whole point of the payload-agnostic profile.
 *
 * Wire layout (all multi-byte integers big-endian):
 *
 * ```
 *   0..2   magic 'R','B','F'                  ← lets a carrier route a frame without parsing it
 *   3      version (1)
 *   4      kind: 0x01 = opaque binary, 0x02 = structured event (UTF-8 JSON body)
 *   5      channel-name length in bytes (1..255)
 *   6..    channel name (UTF-8)
 *   +4     seq (uint32)
 *   ...    body — opaque bytes (kind 0x01) or UTF-8 JSON `{ "event": string, "payload": … }` (0x02)
 * ```
 *
 * The envelope deliberately carries NO length prefix for the body: the carrier already delimits the
 * message (a WebSocket frame is a message boundary), so a length field would only be a second source
 * of truth that can disagree with the first.
 */

import type {
  IBinaryFrame,
  IChannelEventFrame,
  TChannelReceiveResult,
} from '@robota-sdk/agent-interface-transport';

/**
 * The JSON-serializable payload type an event frame carries. Read off the contract (rather than
 * re-importing `agent-core`'s `TUniversalValue`) so this package keeps its single contract edge.
 */
type TEventPayload = IChannelEventFrame['payload'];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** `R`, `B`, `F` — the shared prefix every channel frame starts with. */
export const CHANNEL_FRAME_MAGIC: Uint8Array = encoder.encode('RBF');

/** Envelope version. Bumped only on an incompatible layout change. */
export const CHANNEL_FRAME_VERSION = 1;

const KIND_BINARY = 0x01;
const KIND_EVENT = 0x02;

/** Bytes before the channel name: magic(3) + version(1) + kind(1) + name length(1). */
const PREFIX_BYTES = 6;
/** Bytes after the channel name and before the body: seq(4). */
const SEQ_BYTES = 4;

const MAX_CHANNEL_NAME_BYTES = 255;
const MAX_SEQ = 0xffff_ffff;

/** Validate the envelope fields both encoders share, then return the encoded channel name. */
function encodeChannelName(channel: string, seq: number): Uint8Array {
  const name = encoder.encode(channel);
  if (name.byteLength === 0 || name.byteLength > MAX_CHANNEL_NAME_BYTES) {
    throw new Error(
      `channel name must be 1..${MAX_CHANNEL_NAME_BYTES} UTF-8 bytes (got ${name.byteLength})`,
    );
  }
  if (!Number.isInteger(seq) || seq < 0 || seq > MAX_SEQ) {
    throw new Error(`seq must be an integer in 0..${MAX_SEQ} (got ${seq})`);
  }
  return name;
}

/** Write the shared header into `out` and return the offset where the body starts. */
function writeHeader(out: Uint8Array, kind: number, name: Uint8Array, seq: number): number {
  out.set(CHANNEL_FRAME_MAGIC, 0);
  out[3] = CHANNEL_FRAME_VERSION;
  out[4] = kind;
  out[5] = name.byteLength;
  out.set(name, PREFIX_BYTES);
  const seqAt = PREFIX_BYTES + name.byteLength;
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(seqAt, seq, false);
  return seqAt + SEQ_BYTES;
}

/** Encode an opaque binary frame. The payload bytes are copied verbatim. */
export function encodeBinaryFrame(frame: IBinaryFrame): Uint8Array {
  const name = encodeChannelName(frame.channel, frame.seq);
  const out = new Uint8Array(PREFIX_BYTES + name.byteLength + SEQ_BYTES + frame.payload.byteLength);
  const bodyAt = writeHeader(out, KIND_BINARY, name, frame.seq);
  out.set(frame.payload, bodyAt);
  return out;
}

/** Encode a structured, consumer-declared event frame (UTF-8 JSON body). */
export function encodeChannelEventFrame(frame: IChannelEventFrame): Uint8Array {
  const name = encodeChannelName(frame.channel, frame.seq);
  const body = encoder.encode(JSON.stringify({ event: frame.event, payload: frame.payload }));
  const out = new Uint8Array(PREFIX_BYTES + name.byteLength + SEQ_BYTES + body.byteLength);
  const bodyAt = writeHeader(out, KIND_EVENT, name, frame.seq);
  out.set(body, bodyAt);
  return out;
}

/** True when `bytes` starts with the channel-frame magic — a cheap, non-parsing routing check. */
export function isChannelFrame(bytes: Uint8Array): boolean {
  if (bytes.byteLength < CHANNEL_FRAME_MAGIC.length) return false;
  return CHANNEL_FRAME_MAGIC.every((b, i) => bytes[i] === b);
}

/** The decoded shape of an event frame's JSON body. */
interface IEventBody {
  readonly event?: TEventPayload;
  readonly payload?: TEventPayload;
}

/** Parse the JSON body of an event frame into its `event` + `payload` fields, or state why not. */
function parseEventBody(
  body: Uint8Array,
): { ok: true; event: string; payload: TEventPayload } | { ok: false; error: string } {
  const text = decoder.decode(body);
  let parsed: TEventPayload;
  try {
    parsed = JSON.parse(text) as TEventPayload;
  } catch {
    // An error RESULT, not a fallback: the caller reports it to the peer as a protocol error.
    return { ok: false, error: 'channel frame: malformed JSON body' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'channel frame: event body must be a JSON object' };
  }
  const { event, payload } = parsed as IEventBody;
  if (typeof event !== 'string' || event.length === 0) {
    return { ok: false, error: 'channel frame: event body is missing a non-empty `event` name' };
  }
  return { ok: true, event, payload: payload ?? null };
}

/**
 * Decode a channel frame. Returns an explicit result union — a non-channel, truncated, or malformed
 * input is a stated error the carrier reports to the peer, never a thrown exception on the hot path
 * and never a silently dropped frame.
 */
export function decodeChannelFrame(bytes: Uint8Array): TChannelReceiveResult {
  if (!isChannelFrame(bytes)) {
    return { ok: false, error: 'channel frame: bad magic (not a channel frame)' };
  }
  if (bytes.byteLength < PREFIX_BYTES) {
    return { ok: false, error: 'channel frame: truncated header' };
  }
  if (bytes[3] !== CHANNEL_FRAME_VERSION) {
    return { ok: false, error: `channel frame: unsupported version ${String(bytes[3])}` };
  }

  const kind = bytes[4];
  const nameLength = bytes[5] ?? 0;
  if (nameLength === 0) return { ok: false, error: 'channel frame: empty channel name' };

  const seqAt = PREFIX_BYTES + nameLength;
  const bodyAt = seqAt + SEQ_BYTES;
  if (bytes.byteLength < bodyAt) {
    return { ok: false, error: 'channel frame: truncated (header longer than the frame)' };
  }

  const channel = decoder.decode(bytes.subarray(PREFIX_BYTES, seqAt));
  const seq = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    seqAt,
    false,
  );
  const body = bytes.subarray(bodyAt);

  if (kind === KIND_BINARY) {
    // Copy so the frame does not alias the carrier's (possibly pooled/reused) receive buffer.
    return { ok: true, frame: { kind: 'binary', channel, seq, payload: Uint8Array.from(body) } };
  }
  if (kind === KIND_EVENT) {
    const parsed = parseEventBody(body);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return {
      ok: true,
      frame: { kind: 'event', channel, seq, event: parsed.event, payload: parsed.payload },
    };
  }
  return { ok: false, error: `channel frame: unknown kind ${String(kind)}` };
}
