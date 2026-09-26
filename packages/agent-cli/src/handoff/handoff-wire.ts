/**
 * The frames a hand-off exchanges on its channel, and the split between them and the file carrier's.
 *
 * One channel carries one hand-off. The control frames — who pushes, the binding, the offer and its
 * grant, the answer, the acknowledgement — are this module's; the payload between them travels as a
 * file on the file carrier, which paces it and checks it whole. Each side reads its own frames: a
 * frame the file carrier sent reaches only the file carrier, and nothing it sends can be taken for a
 * control frame.
 *
 * Every frame from the other side is decoded as hostile input.
 */

import type {
  IFileFrameChannel,
  IHandoffCommitAck,
} from '@robota-sdk/agent-interface-session-mobility';

/** Why one side ended a hand-off, as it tells the other. */
export type THandoffWireRefusal =
  /** A session is only ever sent by the side that holds it; nothing asks for one. */
  | 'push-only'
  /** The grant did not authorize this transfer to this destination over this channel. */
  | 'unauthorized'
  /** The receiving operator said no, or could not be asked. */
  | 'declined'
  /** The payload was not the one the manifest sealed. */
  | 'integrity-failed'
  /** The payload was intact and is not a session record this build reads. */
  | 'payload-undecodable'
  /** The destination could not take the session on: no credential of its own, or nowhere to save it. */
  | 'destination-cannot-resume'
  | 'protocol';

const REFUSALS: ReadonlySet<string> = new Set<THandoffWireRefusal>([
  'push-only',
  'unauthorized',
  'declined',
  'integrity-failed',
  'payload-undecodable',
  'destination-cannot-resume',
  'protocol',
]);

export type THandoffControlFrame =
  /** The first frame of the side that holds the session and gives it away. */
  | { readonly t: 'handoff-open' }
  /** Asking another side for its session. Never answered with one. */
  | { readonly t: 'handoff-pull' }
  /** The receiver's fresh value for this channel; the grant must name it. */
  | { readonly t: 'handoff-binding'; readonly nonce: string }
  /** The manifest and the grant for it. Both are decoded by the receiver, not here. */
  | { readonly t: 'handoff-offer'; readonly manifest: unknown; readonly grant: unknown }
  | { readonly t: 'handoff-accept' }
  /** The payload is verified and kept aside, not yet saved. */
  | { readonly t: 'handoff-staged' }
  | { readonly t: 'handoff-ack'; readonly ack: IHandoffCommitAck }
  | {
      readonly t: 'handoff-refuse';
      readonly reason: THandoffWireRefusal;
      readonly detail?: string;
    };

/** Longer than any control frame; a longer one is a peer that does not speak this protocol. */
const MAX_CONTROL_CHARS = 64 * 1024;
const MAX_DETAIL_CHARS = 500;
const NONCE = /^[A-Za-z0-9_-]{43}$/;
/** A side's file carrier finished with the channel; the other side's is told it closed. */
const FILE_CLOSED = 'handoff-file-closed';
/** Control frames that may wait unread. A hand-off is a strict exchange; more is a peer flooding. */
const CONTROL_CAPACITY = 4;

/** Code points that could repaint a terminal, hide text or reorder it. */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]+/g;

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function decodeAck(value: unknown): IHandoffCommitAck | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const ack = value as Record<string, unknown>;
  if (typeof ack['handoffId'] !== 'string' || typeof ack['destinationDeviceId'] !== 'string') {
    return undefined;
  }
  // Only a literal `true` asserts persistence; the source refuses anything else by itself too.
  if (ack['persisted'] !== true || !isCount(ack['committedAt'])) return undefined;
  return {
    handoffId: ack['handoffId'],
    destinationDeviceId: ack['destinationDeviceId'],
    persisted: true,
    committedAt: ack['committedAt'],
  };
}

/** One control frame, or `undefined` when it is not exactly one. */
export function decodeControlFrame(
  value: Record<string, unknown>,
): THandoffControlFrame | undefined {
  switch (value['t']) {
    case 'handoff-open':
    case 'handoff-pull':
    case 'handoff-accept':
    case 'handoff-staged':
      return { t: value['t'] };
    case 'handoff-binding':
      return typeof value['nonce'] === 'string' && NONCE.test(value['nonce'])
        ? { t: 'handoff-binding', nonce: value['nonce'] }
        : undefined;
    case 'handoff-offer':
      return 'manifest' in value && 'grant' in value
        ? { t: 'handoff-offer', manifest: value['manifest'], grant: value['grant'] }
        : undefined;
    case 'handoff-ack': {
      const ack = decodeAck(value['ack']);
      return ack === undefined ? undefined : { t: 'handoff-ack', ack };
    }
    case 'handoff-refuse': {
      const reason = value['reason'];
      const detail = value['detail'];
      if (typeof reason !== 'string' || !REFUSALS.has(reason)) return undefined;
      return {
        t: 'handoff-refuse',
        reason: reason as THandoffWireRefusal,
        // The peer's words, shown to an operator: printable and bounded.
        ...(typeof detail === 'string'
          ? { detail: detail.replace(UNPRINTABLE, ' ').slice(0, MAX_DETAIL_CHARS) }
          : {}),
      };
    }
    default:
      return undefined;
  }
}

/** Why a wire stopped delivering control frames. */
export class HandoffWireEnded extends Error {
  constructor(
    readonly reason: 'closed' | 'timeout' | 'protocol',
    message: string,
  ) {
    super(message);
    this.name = 'HandoffWireEnded';
  }
}

export interface IHandoffWire {
  /** The next control frame, or a rejection with why there will be none. */
  next(timeoutMs: number): Promise<THandoffControlFrame>;
  send(frame: THandoffControlFrame): void;
  /**
   * A channel for the file carrier, for the payload. Its frames are the carrier's alone, and its
   * close tells the other side's carrier, without ending the hand-off's channel.
   */
  fileChannel(): IFileFrameChannel;
  /** Resolves when the other side closes the channel, or after `ms`. */
  closedWithin(ms: number): Promise<void>;
  close(): void;
}

/** The file carrier's view of the channel: its frames, and a close of its own. */
class FileView implements IFileFrameChannel {
  readonly frames = new Set<(frame: string) => void>();
  readonly closes = new Set<() => void>();
  closed = false;

  constructor(private readonly channel: IFileFrameChannel) {}

  send(frame: string): void {
    if (this.closed) throw new Error('the payload channel closed');
    this.channel.send(frame);
  }

  onFrame(handler: (frame: string) => void): () => void {
    this.frames.add(handler);
    return () => this.frames.delete(handler);
  }

  onClose(handler: () => void): () => void {
    if (this.closed) {
      queueMicrotask(handler);
      return () => undefined;
    }
    this.closes.add(handler);
    return () => this.closes.delete(handler);
  }

  /** This side's carrier is done; tell the other side's. */
  close(): void {
    if (this.closed) return;
    try {
      this.channel.send(JSON.stringify({ t: FILE_CLOSED }));
    } catch {
      // allow-fallback: the channel is already gone, which the other side learns by itself.
    }
    this.end();
  }

  /** The other side's carrier is done, or the channel ended. */
  end(): void {
    if (this.closed) return;
    this.closed = true;
    for (const handler of [...this.closes]) handler();
    this.closes.clear();
    this.frames.clear();
  }
}

/** Put the hand-off's frames and the file carrier's on one channel, each read only by its own side. */
export function openHandoffWire(channel: IFileFrameChannel): IHandoffWire {
  const queue: THandoffControlFrame[] = [];
  let waiter:
    | { resolve: (frame: THandoffControlFrame) => void; reject: (error: HandoffWireEnded) => void }
    | undefined;
  let failure: HandoffWireEnded | undefined;
  let file: FileView | undefined;
  const peerClosed = new AbortController();

  const fail = (error: HandoffWireEnded): void => {
    if (failure !== undefined) return;
    failure = error;
    if (error.reason === 'protocol') queue.length = 0;
    const pending = waiter;
    waiter = undefined;
    pending?.reject(error);
  };

  const stopFrames = channel.onFrame((text) => {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      value = undefined;
    }
    if (typeof value !== 'object' || value === null) {
      fail(new HandoffWireEnded('protocol', 'a frame could not be read'));
      return;
    }
    const t = (value as { t?: unknown }).t;
    if (typeof t === 'string' && t.startsWith('file-')) {
      // Only while this side's carrier is reading; at any other time it is a frame out of place.
      if (file === undefined || file.closed) {
        fail(new HandoffWireEnded('protocol', 'a payload frame arrived outside the payload'));
        return;
      }
      for (const handler of [...file.frames]) handler(text);
      return;
    }
    if (t === FILE_CLOSED) {
      file?.end();
      return;
    }
    const frame =
      text.length > MAX_CONTROL_CHARS
        ? undefined
        : decodeControlFrame(value as Record<string, unknown>);
    if (frame === undefined) {
      fail(new HandoffWireEnded('protocol', 'a hand-off frame could not be read'));
      return;
    }
    if (waiter !== undefined) {
      const { resolve } = waiter;
      waiter = undefined;
      resolve(frame);
      return;
    }
    if (queue.length >= CONTROL_CAPACITY) {
      fail(new HandoffWireEnded('protocol', 'the peer sent frames nobody asked for'));
      return;
    }
    queue.push(frame);
  });
  const stopClose = channel.onClose(() => {
    peerClosed.abort();
    file?.end();
    fail(new HandoffWireEnded('closed', 'the connection ended'));
  });

  return {
    next(timeoutMs) {
      const queued = queue.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      if (failure !== undefined) return Promise.reject(failure);
      return new Promise<THandoffControlFrame>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = undefined;
          reject(new HandoffWireEnded('timeout', `nothing arrived within ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref?.();
        waiter = {
          resolve: (frame) => {
            clearTimeout(timer);
            resolve(frame);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        };
      });
    },
    send(frame) {
      channel.send(JSON.stringify(frame));
    },
    fileChannel() {
      if (file !== undefined) throw new Error('a hand-off carries one payload');
      file = new FileView(channel);
      if (peerClosed.signal.aborted) file.end();
      return file;
    },
    closedWithin(ms) {
      if (peerClosed.signal.aborted) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          peerClosed.signal.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, ms);
        timer.unref?.();
        peerClosed.signal.addEventListener('abort', done, { once: true });
      });
    },
    close() {
      stopFrames();
      stopClose();
      file?.end();
      channel.close();
    },
  };
}
