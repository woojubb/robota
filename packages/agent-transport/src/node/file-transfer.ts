/**
 * The file carrier: one file over one frame channel, in either direction, whatever the channel runs on.
 *
 * ## Shape
 *
 * The sender offers name, size and hash, and sends nothing more until the receiver accepts; the
 * receiver decides (its operator's yes, somewhere to put the file) before a byte arrives. Content
 * then moves in chunks, and the receiver checks the whole against the offer before it is kept. A
 * mismatch discards it. There is no resume: a transfer that ends early is simply gone.
 *
 * ## Backpressure
 *
 * The receiver grants credit as it persists chunks, and the sender keeps at most a window of chunks
 * unconfirmed. So neither side buffers more than the window, however fast the sender reads or slow
 * the receiver's disk, and the bound holds on every channel without asking it about its buffers. A
 * receiver that is sent past its credit ends the transfer: holding the excess is exactly what the
 * window exists to prevent.
 *
 * ## Why chunks are base64 in JSON text
 *
 * Every channel it runs on carries text frames, and a frame is decoded as hostile input on arrival.
 * One encoding for every frame keeps that decoding in one place; base64 costs a third of bandwidth,
 * which the size limit already bounds.
 */

import { createHash, type Hash } from 'node:crypto';

import type { IFileFrameChannel, IFileOffer } from '@robota-sdk/agent-interface-session-mobility';

/** Why a transfer did not end with the file kept. */
export type TFileTransferRefusal =
  /** The receiving operator said no, could not be asked, or the connection does not carry files. */
  | 'declined'
  /** The file is over the size limit. */
  | 'too-large'
  /** The name is empty, or would leave the receiving directory. */
  | 'bad-name'
  /** A file of that name was already received; nothing is overwritten. */
  | 'exists'
  /** The receiving directory is not one this user owns outright, e.g. a symbolic link. */
  | 'unsafe-path'
  /** The content did not match the offered size or hash. The partial file is discarded. */
  | 'integrity'
  /** A frame broke the protocol. */
  | 'protocol'
  /** The channel ended first. */
  | 'closed'
  /** The other side went quiet. */
  | 'timeout'
  /** The receiver could not store the file. */
  | 'unavailable';

/**
 * The default size limit. A transfer does not resume, so a dropped connection costs the whole file
 * again; a received file also sits on the receiver's disk until its operator removes it. The limit
 * keeps both costs small while covering what is sent between one's own sessions: sources, logs,
 * screenshots, a small archive.
 */
export const DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024;

/** Bytes of content per chunk: what every SCTP implementation carries without negotiation. */
export const FILE_CHUNK_BYTES = 16 * 1024;
/** Chunks the sender may have unconfirmed. */
export const FILE_CREDIT_WINDOW = 16;
/** A frame longer than a full chunk and its envelope is not one this protocol sends. */
const MAX_FRAME_CHARS = Math.ceil(FILE_CHUNK_BYTES / 3) * 4 + 512;
const MAX_NAME_CHARS = 1024;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** Between frames once content flows. */
const DEFAULT_IDLE_MS = 30_000;
/** For the receiving operator to answer. */
const DEFAULT_DECISION_MS = 5 * 60_000;
/** How long the receiver waits, after its last frame, for the sender to close. */
const LAST_WORD_MS = 5_000;

/** Where content comes from. `read` yields the content once, in order, in pieces of any size. */
export interface IFileSource {
  readonly size: number;
  read(): AsyncIterable<Uint8Array>;
}

/** Where received content goes until it is verified; nothing is kept unless `commit` runs. */
export interface IFileSink {
  write(chunk: Uint8Array): Promise<void>;
  /** Keep the verified file. Resolves with where it is. */
  commit(): Promise<string>;
  /** Drop what was written. */
  discard(): Promise<void>;
}

/** The receiver's decision on an offer: somewhere to put it, or why not. */
export type TFileAdmission =
  | { readonly sink: IFileSink }
  | { readonly refused: TFileTransferRefusal; readonly detail?: string };

export type TFileSendOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: TFileTransferRefusal; readonly detail?: string };

export type TFileReceiveOutcome =
  | { readonly ok: true; readonly offer: IFileOffer; readonly location: string }
  | {
      readonly ok: false;
      readonly reason: TFileTransferRefusal;
      readonly detail?: string;
      readonly offer?: IFileOffer;
    };

type TFrame =
  | ({ readonly t: 'file-offer' } & IFileOffer)
  | { readonly t: 'file-accept' }
  | { readonly t: 'file-refuse'; readonly reason: TFileTransferRefusal; readonly detail?: string }
  | { readonly t: 'file-chunk'; readonly seq: number; readonly data: string }
  | { readonly t: 'file-credit'; readonly upTo: number }
  | { readonly t: 'file-end'; readonly chunks: number }
  | { readonly t: 'file-done' };

const REFUSALS: ReadonlySet<string> = new Set<TFileTransferRefusal>([
  'declined',
  'too-large',
  'bad-name',
  'exists',
  'unsafe-path',
  'integrity',
  'protocol',
  'closed',
  'timeout',
  'unavailable',
]);

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Decode one frame as hostile input: anything not exactly a frame of this protocol is `undefined`. */
function decodeFrame(text: string): TFrame | undefined {
  if (text.length > MAX_FRAME_CHARS) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const frame = value as Record<string, unknown>;
  switch (frame['t']) {
    case 'file-offer': {
      const { transferId, name, size, sha256 } = frame;
      if (typeof transferId !== 'string' || transferId.length === 0 || transferId.length > 128) {
        return undefined;
      }
      if (typeof name !== 'string' || name.length > MAX_NAME_CHARS) return undefined;
      if (!isCount(size) || typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) {
        return undefined;
      }
      return { t: 'file-offer', transferId, name, size, sha256 };
    }
    case 'file-accept':
      return { t: 'file-accept' };
    case 'file-refuse': {
      const reason = frame['reason'];
      const detail = frame['detail'];
      if (typeof reason !== 'string' || !REFUSALS.has(reason)) return undefined;
      return {
        t: 'file-refuse',
        reason: reason as TFileTransferRefusal,
        ...(typeof detail === 'string' ? { detail: detail.slice(0, 500) } : {}),
      };
    }
    case 'file-chunk': {
      const { seq, data } = frame;
      if (!isCount(seq) || typeof data !== 'string' || !BASE64.test(data)) return undefined;
      return { t: 'file-chunk', seq, data };
    }
    case 'file-credit':
      return isCount(frame['upTo']) ? { t: 'file-credit', upTo: frame['upTo'] } : undefined;
    case 'file-end':
      return isCount(frame['chunks']) ? { t: 'file-end', chunks: frame['chunks'] } : undefined;
    case 'file-done':
      return { t: 'file-done' };
    default:
      return undefined;
  }
}

class TransferEnded extends Error {
  constructor(
    readonly reason: TFileTransferRefusal,
    readonly detail?: string,
  ) {
    super(detail ?? reason);
  }
}

/**
 * The frames of one channel, taken one at a time. Frames beyond `capacity` waiting to be taken are a
 * peer ignoring the protocol's pacing, and end the transfer rather than growing the queue.
 */
class FrameReader {
  private readonly queue: TFrame[] = [];
  private waiter?: { resolve: (frame: TFrame) => void; reject: (error: TransferEnded) => void };
  private failure?: TransferEnded;
  private readonly stops: (() => void)[] = [];

  constructor(
    channel: IFileFrameChannel,
    private readonly capacity: number,
  ) {
    this.stops.push(
      channel.onFrame((text) => {
        const frame = decodeFrame(text);
        if (frame === undefined) {
          this.fail(new TransferEnded('protocol', 'a frame could not be read'));
          return;
        }
        if (this.waiter !== undefined) {
          const { resolve } = this.waiter;
          this.waiter = undefined;
          resolve(frame);
          return;
        }
        if (this.queue.length >= this.capacity) {
          this.fail(new TransferEnded('protocol', 'the peer sent past its credit'));
          return;
        }
        this.queue.push(frame);
      }),
      channel.onClose(() => this.fail(new TransferEnded('closed', 'the channel closed'))),
    );
  }

  private fail(error: TransferEnded): void {
    if (this.failure !== undefined) return;
    this.failure = error;
    // A peer that broke the protocol is not read further; frames it queued are not acted on.
    if (error.reason === 'protocol') this.queue.length = 0;
    const waiter = this.waiter;
    this.waiter = undefined;
    waiter?.reject(error);
  }

  /** The next frame, or the reason there will be none. */
  next(timeoutMs: number): Promise<TFrame> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.failure !== undefined) return Promise.reject(this.failure);
    return new Promise<TFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = undefined;
        reject(new TransferEnded('timeout', `nothing arrived within ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      this.waiter = {
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
  }

  /** Whether the channel already ended or broke the protocol. */
  get ended(): boolean {
    return this.failure !== undefined;
  }

  stop(): void {
    for (const stop of this.stops.splice(0)) stop();
  }
}

function send(channel: IFileFrameChannel, frame: TFrame): void {
  try {
    channel.send(JSON.stringify(frame));
  } catch (error) {
    throw new TransferEnded('closed', error instanceof Error ? error.message : String(error));
  }
}

function ended(error: unknown): TransferEnded {
  return error instanceof TransferEnded
    ? error
    : new TransferEnded('unavailable', error instanceof Error ? error.message : String(error));
}

/** Cut a source's content into chunks of exactly `size` bytes, the last one shorter. */
async function* rechunk(source: AsyncIterable<Uint8Array>, size: number): AsyncGenerator<Buffer> {
  let pending = Buffer.alloc(0);
  for await (const piece of source) {
    pending = pending.length === 0 ? Buffer.from(piece) : Buffer.concat([pending, piece]);
    while (pending.length >= size) {
      yield pending.subarray(0, size);
      pending = pending.subarray(size);
    }
  }
  if (pending.length > 0) yield pending;
}

export interface ISendFileOptions {
  readonly channel: IFileFrameChannel;
  readonly offer: IFileOffer;
  readonly source: IFileSource;
  readonly chunkBytes?: number;
  readonly window?: number;
  readonly idleMs?: number;
  /** How long the receiving operator may take to answer. */
  readonly decisionMs?: number;
}

/**
 * Offer a file and, once accepted, send it. Resolves when the receiver confirms it kept the file, or
 * with why it did not. Closes the channel either way.
 */
export async function sendFileOverChannel(options: ISendFileOptions): Promise<TFileSendOutcome> {
  const { channel, offer, source } = options;
  const chunkBytes = options.chunkBytes ?? FILE_CHUNK_BYTES;
  const window = options.window ?? FILE_CREDIT_WINDOW;
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  // The receiver sends one credit per chunk and one final frame; nothing else is legitimate.
  const reader = new FrameReader(channel, window + 2);
  try {
    if (source.size !== offer.size) {
      throw new TransferEnded('integrity', 'the source is not the size offered');
    }
    send(channel, { t: 'file-offer', ...offer });
    const answer = await reader.next(options.decisionMs ?? DEFAULT_DECISION_MS);
    if (answer.t === 'file-refuse') throw new TransferEnded(answer.reason, answer.detail);
    if (answer.t !== 'file-accept') throw new TransferEnded('protocol', 'expected an answer');

    let sent = 0;
    let credited = 0;
    let bytes = 0;
    const take = async (): Promise<void> => {
      const frame = await reader.next(idleMs);
      if (frame.t === 'file-refuse') throw new TransferEnded(frame.reason, frame.detail);
      if (frame.t !== 'file-credit' || frame.upTo <= credited || frame.upTo > sent) {
        throw new TransferEnded('protocol', 'expected credit');
      }
      credited = frame.upTo;
    };
    for await (const chunk of rechunk(source.read(), chunkBytes)) {
      bytes += chunk.length;
      if (bytes > offer.size) throw new TransferEnded('integrity', 'the source grew while sending');
      while (sent - credited >= window) await take();
      send(channel, { t: 'file-chunk', seq: sent, data: chunk.toString('base64') });
      sent += 1;
    }
    if (bytes !== offer.size)
      throw new TransferEnded('integrity', 'the source shrank while sending');
    send(channel, { t: 'file-end', chunks: sent });
    for (;;) {
      const frame = await reader.next(idleMs);
      if (frame.t === 'file-done') return { ok: true };
      if (frame.t === 'file-refuse') throw new TransferEnded(frame.reason, frame.detail);
      if (frame.t !== 'file-credit' || frame.upTo <= credited || frame.upTo > sent) {
        throw new TransferEnded('protocol', 'expected credit or completion');
      }
      credited = frame.upTo;
    }
  } catch (error) {
    const end = ended(error);
    return {
      ok: false,
      reason: end.reason,
      ...(end.detail !== undefined ? { detail: end.detail } : {}),
    };
  } finally {
    reader.stop();
    channel.close();
  }
}

export interface IReceiveFileOptions {
  readonly channel: IFileFrameChannel;
  /** Offers above this are refused without asking anyone. */
  readonly maxBytes?: number;
  /**
   * Decide on a well-formed offer within the size limit: ask whoever must approve it, and open
   * somewhere to put it. `signal` aborts when the sender goes away.
   */
  readonly admit: (offer: IFileOffer, signal: AbortSignal) => Promise<TFileAdmission>;
  readonly window?: number;
  readonly idleMs?: number;
}

/**
 * Receive one file: the channel's first frame is the offer. Resolves with where the verified file was
 * kept, or with why nothing was. Closes the channel either way.
 */
export async function receiveFileOverChannel(
  options: IReceiveFileOptions,
): Promise<TFileReceiveOutcome> {
  const { channel } = options;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
  const window = options.window ?? FILE_CREDIT_WINDOW;
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  // The sender may be a window of chunks ahead of what was written, plus its end frame.
  const reader = new FrameReader(channel, window + 1);
  const gone = new AbortController();
  const stopWatching = channel.onClose(() => gone.abort());
  let offer: IFileOffer | undefined;
  let sink: IFileSink | undefined;
  let lastWord = true;
  try {
    const first = await reader.next(idleMs);
    if (first.t !== 'file-offer') throw new TransferEnded('protocol', 'expected an offer');
    offer = {
      transferId: first.transferId,
      name: first.name,
      size: first.size,
      sha256: first.sha256,
    };
    if (offer.size > maxBytes) {
      throw new TransferEnded(
        'too-large',
        `${offer.size} bytes is over the ${maxBytes}-byte limit`,
      );
    }
    const admission = await options.admit(offer, gone.signal);
    if ('refused' in admission) throw new TransferEnded(admission.refused, admission.detail);
    sink = admission.sink;
    if (reader.ended) throw new TransferEnded('closed', 'the sender left before the answer');
    send(channel, { t: 'file-accept' });

    const hash: Hash = createHash('sha256');
    let next = 0;
    let bytes = 0;
    for (;;) {
      const frame = await reader.next(idleMs);
      if (frame.t === 'file-end') {
        if (frame.chunks !== next || bytes !== offer.size) {
          throw new TransferEnded('integrity', 'the content is not the size offered');
        }
        if (hash.digest('hex') !== offer.sha256) {
          throw new TransferEnded('integrity', 'the content does not match the offered sha256');
        }
        const location = await sink.commit();
        sink = undefined;
        send(channel, { t: 'file-done' });
        return { ok: true, offer, location };
      }
      if (frame.t !== 'file-chunk' || frame.seq !== next) {
        throw new TransferEnded('protocol', 'expected the next chunk');
      }
      const data = Buffer.from(frame.data, 'base64');
      bytes += data.length;
      if (bytes > offer.size) throw new TransferEnded('integrity', 'more content than offered');
      hash.update(data);
      await sink.write(data);
      next += 1;
      send(channel, { t: 'file-credit', upTo: next });
    }
  } catch (error) {
    const end = ended(error);
    lastWord = end.reason !== 'protocol';
    if (sink !== undefined) {
      // allow-fallback: the transfer already failed for `end`; a failed cleanup must not replace why.
      await sink.discard().catch(() => undefined);
    }
    if (end.reason !== 'closed' && end.reason !== 'timeout') {
      try {
        send(channel, {
          t: 'file-refuse',
          reason: end.reason,
          ...(end.detail !== undefined ? { detail: end.detail } : {}),
        });
      } catch {
        // allow-fallback: the sender is already gone; the outcome below says why.
      }
    }
    return {
      ok: false,
      reason: end.reason,
      ...(end.detail !== undefined ? { detail: end.detail } : {}),
      ...(offer !== undefined ? { offer } : {}),
    };
  } finally {
    // The sender closes once it has the last word; closing first could cut that word off.
    if (lastWord) await closed(gone.signal, LAST_WORD_MS);
    stopWatching();
    reader.stop();
    channel.close();
  }
}

/** Resolves when `signal` aborts, or after `ms`. */
function closed(signal: AbortSignal, ms: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    timer.unref?.();
    signal.addEventListener('abort', done, { once: true });
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}
