/**
 * What two device mesh nodes say to each other through the relay, and the frames their data channel
 * carries. Everything here arrives from an untrusted relay or an unadmitted peer, so every field is
 * bounded and shape-checked before it is used, and a failure names no value.
 *
 * `hello` is presence: a node announces its instance to a peer's inbox. The instance is a random id
 * per node run, so a restarted peer is told apart from its previous run without naming the device.
 * An attempt (`cid`) scopes an offer, its answer and their ICE candidates to one connection.
 */

/** A per-run instance id or a connection-attempt id: 128 random bits, base64url. */
const RANDOM_ID = /^[A-Za-z0-9_-]{22}$/;
/** An SDP a relay frame can carry; the relay itself caps a frame well below this. */
const MAX_SDP_CHARS = 48 * 1024;
const MAX_CANDIDATE_CHARS = 2048;
/** Largest message body a data-channel `mesh-msg` frame carries. */
export const MAX_MESH_MESSAGE_CHARS = 60_000;

export const MESH_SIGNAL_VERSION = 1;

export interface IMeshHello {
  readonly v: typeof MESH_SIGNAL_VERSION;
  readonly kind: 'hello';
  readonly from: string;
}

export interface IMeshDescription {
  readonly v: typeof MESH_SIGNAL_VERSION;
  readonly kind: 'offer' | 'answer';
  readonly from: string;
  readonly to: string;
  readonly cid: string;
  readonly sdp: string;
}

export interface IMeshIce {
  readonly v: typeof MESH_SIGNAL_VERSION;
  readonly kind: 'ice';
  readonly from: string;
  readonly to: string;
  readonly cid: string;
  readonly candidate: {
    readonly candidate: string;
    readonly sdpMid?: string;
    readonly sdpMLineIndex?: number;
  };
}

export type TMeshSignal = IMeshHello | IMeshDescription | IMeshIce;

function isId(value: unknown): value is string {
  return typeof value === 'string' && RANDOM_ID.test(value);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

/** A relay-delivered signal, or `undefined` when it is not one this node would act on. */
export function decodeMeshSignal(value: unknown): TMeshSignal | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const r = value as Record<string, unknown>;
  if (r.v !== MESH_SIGNAL_VERSION || !isId(r.from)) return undefined;
  if (r.kind === 'hello') return { v: MESH_SIGNAL_VERSION, kind: 'hello', from: r.from };
  if (!isId(r.to) || !isId(r.cid)) return undefined;
  if (r.kind === 'offer' || r.kind === 'answer') {
    if (!isBoundedString(r.sdp, MAX_SDP_CHARS)) return undefined;
    return { v: MESH_SIGNAL_VERSION, kind: r.kind, from: r.from, to: r.to, cid: r.cid, sdp: r.sdp };
  }
  if (r.kind === 'ice') {
    const c = r.candidate;
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return undefined;
    const cr = c as Record<string, unknown>;
    if (!isBoundedString(cr.candidate, MAX_CANDIDATE_CHARS)) return undefined;
    if (cr.sdpMid !== undefined && !isBoundedString(cr.sdpMid, 64)) return undefined;
    if (
      cr.sdpMLineIndex !== undefined &&
      !(
        typeof cr.sdpMLineIndex === 'number' &&
        Number.isInteger(cr.sdpMLineIndex) &&
        cr.sdpMLineIndex >= 0 &&
        cr.sdpMLineIndex < 64
      )
    ) {
      return undefined;
    }
    return {
      v: MESH_SIGNAL_VERSION,
      kind: 'ice',
      from: r.from,
      to: r.to,
      cid: r.cid,
      candidate: {
        candidate: cr.candidate,
        ...(cr.sdpMid !== undefined ? { sdpMid: cr.sdpMid as string } : {}),
        ...(cr.sdpMLineIndex !== undefined ? { sdpMLineIndex: cr.sdpMLineIndex as number } : {}),
      },
    };
  }
  return undefined;
}

/** The one frame an admitted link carries. */
export interface IMeshMessageFrame {
  readonly t: 'mesh-msg';
  readonly body: string;
}

export function decodeMeshMessageFrame(value: unknown): IMeshMessageFrame | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const r = value as Record<string, unknown>;
  if (r.t !== 'mesh-msg' || typeof r.body !== 'string' || r.body.length > MAX_MESH_MESSAGE_CHARS) {
    return undefined;
  }
  return { t: 'mesh-msg', body: r.body };
}
