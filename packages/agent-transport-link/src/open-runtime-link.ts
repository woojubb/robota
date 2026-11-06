/**
 * The client's end of an owner link: the spawner of a runtime, or its owner.
 *
 * A client writes the request line and its hello, checks the runtime's challenge (the keyring's
 * initiator decides), and only then sends its proof; a runtime that is not the one it must be gets
 * nothing more, and opening rejects with the keyring's `LinkRefusedError`. The link is open once
 * the runtime's first sealed frame, its custody notice, arrives: a runtime that refused the proof
 * closes instead. After that the client asks the owner vocabulary, sends read grants (owner links
 * only) and carries the session protocol, and everything it receives is strictly decoded; anything
 * that does not decode, or answers a request it did not ask, ends the link.
 */
import type { Duplex } from 'node:stream';

import {
  KeyringError,
  LINK_CHALLENGE_MAX_BYTES,
  LINK_FRAME_OVERHEAD_BYTES,
  createLinkInitiator,
  linkFrameKind,
  type IInitiatorLink,
  type ILinkBinding,
  type IOwnerHandover,
  type ITrustRoot,
  type SpawnerKey,
  type TLinkInitiatorAuth,
  type TLinkMode,
} from '@robota-sdk/agent-keyring';
import {
  decodeFrame,
  decodeServerMessage,
  type TClientMessage,
  type TServerMessage,
} from '@robota-sdk/agent-transport';

import {
  OwnerLinkClosedError,
  OwnerRequestRefusedError,
  type IOwnerControlRequest,
  type IRuntimeCustodyState,
  type TGrantOutcome,
  type TOwnerControlResult,
  type TOwnerSessionQuestion,
  type TRequestedLockReason,
} from './link-ports.js';
import {
  MAX_REQUESTS_IN_FLIGHT,
  MAX_PENDING_CLIENT_BYTES,
  OWNER_FRAME_MAX_BYTES,
  SEALED_FRAME_MAX_BYTES,
  SESSION_FRAME_MAX_BYTES,
} from './link-bounds.js';
import { encodeLinkFrame, encodeLinkOpening, readLinkFrames } from './link-stream.js';
import {
  decodeRuntimeMessage,
  encodeOwnerRequest,
  type TOwnerRequest,
  type TRuntimeMessage,
} from './owner-vocabulary.js';

/** A client gives up on a runtime that has not admitted it by then. */
export const DEFAULT_OPEN_TIMEOUT_MS = 10_000;

export interface IOpenRuntimeLinkOptions {
  readonly timeoutMs?: number;
}

/** The session protocol over the link: what an attach client or a desktop relay sends and hears. */
export interface ILinkSessionChannel {
  send(message: TClientMessage): void;
  onMessage(listener: (message: TServerMessage) => void): () => void;
}

/**
 * One open link, as its client holds it. Only so many requests (read grants included) may wait for
 * the runtime's answer at once; one more is refused at once with an `OwnerRequestRefusedError` coded
 * `busy`, is not sent, and leaves the link open.
 */
export interface IRuntimeLinkClient {
  readonly standing: TLinkMode;
  /** The runtime start the handshake proved. */
  readonly binding: ILinkBinding;
  /** The runtime's instance key: the exchange's (spawner) or the certified one (owner). */
  readonly instancePublicKey: Uint8Array;
  /** The custody state the runtime announced last. */
  readonly custody: IRuntimeCustodyState;
  onCustody(listener: (state: IRuntimeCustodyState) => void): () => void;
  installTrustRoot(root: ITrustRoot): Promise<void>;
  lock(reason: TRequestedLockReason): Promise<void>;
  question(sessionId: string): Promise<TOwnerSessionQuestion>;
  openAccepted(sessionId: string, acceptedDigest: string): Promise<void>;
  control(request: IOwnerControlRequest): Promise<TOwnerControlResult>;
  readonly session: ILinkSessionChannel;
  /** Settles once the link has closed, for whatever reason. */
  readonly closed: Promise<void>;
  close(): void;
}

/** An owner link, which alone can unlock the runtime. */
export interface IOwnerRuntimeLinkClient extends IRuntimeLinkClient {
  /** Seals the owner's read keys for this runtime and sends them. */
  unlock(): Promise<TGrantOutcome>;
}

type TExpectedReply = TRuntimeMessage['op'];

interface IPendingRequest {
  readonly expects: TExpectedReply;
  readonly resolve: (message: TRuntimeMessage) => void;
  readonly reject: (error: Error) => void;
}

const textDecoder = new TextDecoder('utf-8', { fatal: true });
const textEncoder = new TextEncoder();

/** Calls every listener; one that throws is the caller's bug and must not end the link for the rest. */
function notify<TValue>(listeners: ReadonlySet<(value: TValue) => void>, value: TValue): void {
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch {
      // allow-fallback: the frame was valid; a failing listener cannot make the runtime's message wrong.
    }
  }
}

class RuntimeLinkClient implements IOwnerRuntimeLinkClient {
  readonly closed: Promise<void>;
  readonly session: ILinkSessionChannel;
  readonly #stream: Duplex;
  readonly #link: IInitiatorLink;
  readonly #handover: IOwnerHandover | undefined;
  readonly #pending = new Map<string, IPendingRequest>();
  readonly #custodyListeners = new Set<(state: IRuntimeCustodyState) => void>();
  readonly #sessionListeners = new Set<(message: TServerMessage) => void>();
  #custody: IRuntimeCustodyState;
  #requests = 0;
  #grants = 0;
  #ended = false;
  #resolveClosed!: () => void;

  constructor(
    stream: Duplex,
    link: IInitiatorLink,
    custody: IRuntimeCustodyState,
    handover: IOwnerHandover | undefined,
  ) {
    this.#stream = stream;
    this.#link = link;
    this.#custody = custody;
    this.#handover = handover;
    this.closed = new Promise((resolve) => {
      this.#resolveClosed = resolve;
    });
    this.session = {
      send: (message) => this.#sendSession(message),
      onMessage: (listener) => {
        this.#sessionListeners.add(listener);
        return () => {
          this.#sessionListeners.delete(listener);
        };
      },
    };
  }

  get standing(): TLinkMode {
    return this.#link.standing;
  }

  get binding(): ILinkBinding {
    return this.#link.binding;
  }

  get instancePublicKey(): Uint8Array {
    return this.#link.instancePublicKey;
  }

  get custody(): IRuntimeCustodyState {
    return this.#custody;
  }

  onCustody(listener: (state: IRuntimeCustodyState) => void): () => void {
    this.#custodyListeners.add(listener);
    return () => {
      this.#custodyListeners.delete(listener);
    };
  }

  async installTrustRoot(root: ITrustRoot): Promise<void> {
    await this.#request((requestId) => ({ op: 'install-trust-root', requestId, root }), 'done');
  }

  async lock(reason: TRequestedLockReason): Promise<void> {
    await this.#request((requestId) => ({ op: 'lock', requestId, reason }), 'done');
  }

  async question(sessionId: string): Promise<TOwnerSessionQuestion> {
    const reply = await this.#request(
      (requestId) => ({ op: 'question', requestId, sessionId }),
      'question',
    );
    return (reply as Extract<TRuntimeMessage, { op: 'question' }>).question;
  }

  async openAccepted(sessionId: string, acceptedDigest: string): Promise<void> {
    await this.#request(
      (requestId) => ({ op: 'open-accepted', requestId, sessionId, acceptedDigest }),
      'done',
    );
  }

  async control(request: IOwnerControlRequest): Promise<TOwnerControlResult> {
    const reply = await this.#request(
      (requestId) => ({ op: 'control', requestId, request }),
      'control',
    );
    return (reply as Extract<TRuntimeMessage, { op: 'control' }>).result;
  }

  async unlock(): Promise<TGrantOutcome> {
    if (this.#handover === undefined) {
      throw new OwnerRequestRefusedError('not-owner', 'Only an owner link can unlock the runtime.');
    }
    const handover = this.#handover;
    const requestId = `g${this.#grants + 1}`;
    const reply = await this.#await(requestId, 'unlocked', () => {
      this.#grants += 1;
      this.#write(this.#link.sealReadGrant(handover));
    });
    return (reply as Extract<TRuntimeMessage, { op: 'unlocked' }>).sealingKey;
  }

  close(): void {
    this.#stream.destroy();
  }

  /** One frame from the runtime; anything that is not exactly what it may send ends the link. */
  receive(frame: Uint8Array): void {
    const kind = linkFrameKind(frame);
    const bound = kind === 'owner' ? OWNER_FRAME_MAX_BYTES : SESSION_FRAME_MAX_BYTES;
    if (kind === 'grant' || frame.length > bound + LINK_FRAME_OVERHEAD_BYTES) {
      throw new RangeError('The runtime sent a frame it may not.');
    }
    const { plaintext } = this.#link.open(frame);
    if (kind === 'session') {
      const decoded = decodeFrame(textDecoder.decode(plaintext), decodeServerMessage);
      if (!decoded.ok)
        throw new RangeError('The runtime sent a session message that does not decode.');
      notify(this.#sessionListeners, decoded.message);
      return;
    }
    const message = decodeRuntimeMessage(plaintext);
    if (message === undefined)
      throw new RangeError('The runtime sent a message outside the vocabulary.');
    if (message.op === 'custody') {
      this.#custody = message.state;
      notify(this.#custodyListeners, message.state);
      return;
    }
    const pending = this.#pending.get(message.requestId);
    if (pending === undefined || (message.op !== pending.expects && message.op !== 'refused')) {
      throw new RangeError('The runtime answered a request that was not asked.');
    }
    this.#pending.delete(message.requestId);
    if (message.op === 'refused')
      pending.reject(new OwnerRequestRefusedError(message.code, message.message));
    else pending.resolve(message);
  }

  /** The link ended: everything still waiting is rejected. */
  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#link.close();
    for (const pending of this.#pending.values()) pending.reject(new OwnerLinkClosedError());
    this.#pending.clear();
    this.#resolveClosed();
  }

  #sendSession(message: TClientMessage): void {
    const bytes = textEncoder.encode(JSON.stringify(message));
    if (bytes.length > SESSION_FRAME_MAX_BYTES) {
      throw new RangeError('A session message over the frame bound.');
    }
    if (this.#ended) throw new OwnerLinkClosedError();
    this.#write(this.#link.seal('session', bytes));
  }

  #request(
    build: (requestId: string) => TOwnerRequest,
    expects: TExpectedReply,
  ): Promise<TRuntimeMessage> {
    const requestId = `r${this.#requests + 1}`;
    // Encoding first, so a request outside the vocabulary is the caller's error and never reaches the link.
    const bytes = encodeOwnerRequest(build(requestId));
    return this.#await(requestId, expects, () => {
      this.#requests += 1;
      this.#write(this.#link.seal('owner', bytes));
    });
  }

  #await(requestId: string, expects: TExpectedReply, send: () => void): Promise<TRuntimeMessage> {
    if (this.#ended) return Promise.reject(new OwnerLinkClosedError());
    // Refused here, not queued: a runtime ends a link whose peer has more waiting than it allows.
    if (this.#pending.size >= MAX_REQUESTS_IN_FLIGHT) {
      return Promise.reject(
        new OwnerRequestRefusedError('busy', 'The link has as many requests waiting as it allows.'),
      );
    }
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { expects, resolve, reject });
      try {
        send();
      } catch (error) {
        this.#pending.delete(requestId);
        reject(error);
      }
    });
  }

  #write(sealed: Uint8Array): void {
    const framed = encodeLinkFrame(sealed);
    if (
      this.#stream.destroyed ||
      !this.#stream.writable ||
      this.#stream.writableLength + framed.length > MAX_PENDING_CLIENT_BYTES
    ) {
      this.#stream.destroy();
      throw new OwnerLinkClosedError();
    }
    try {
      this.#stream.write(framed);
    } catch (error) {
      this.#stream.destroy();
      throw error;
    }
  }
}

function openRuntimeLink(
  stream: Duplex,
  auth: TLinkInitiatorAuth,
  options: IOpenRuntimeLinkOptions,
): Promise<RuntimeLinkClient> {
  return new Promise((resolve, reject) => {
    let initiator: ReturnType<typeof createLinkInitiator>;
    try {
      initiator = createLinkInitiator(auth);
    } catch (error) {
      stream.destroy();
      reject(error);
      return;
    }
    let link: IInitiatorLink | undefined;
    let client: RuntimeLinkClient | undefined;
    /** Why the initiator refused the runtime's answer, if it did; any other end says nothing. */
    let refusal: unknown;
    const fail = (): void => {
      stream.destroy();
    };
    // Rejects itself: a stream that does not report its own close must not leave the opening waiting.
    const timer = setTimeout(() => {
      fail();
      link?.close();
      reject(new OwnerLinkClosedError());
    }, options.timeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS);
    timer.unref?.();

    readLinkFrames(stream, {
      maxBytes: () => (link === undefined ? LINK_CHALLENGE_MAX_BYTES : SEALED_FRAME_MAX_BYTES),
      onFrame: (frame): void | 'yield' => {
        if (client !== undefined) {
          try {
            client.receive(frame);
          } catch {
            stream.destroy();
          }
          return;
        }
        if (link === undefined) {
          try {
            const answered = initiator.answer(frame);
            link = answered.link;
            stream.write(encodeLinkFrame(answered.proof));
          } catch (error) {
            refusal = error;
            fail();
          }
          return;
        }
        // The runtime's first frame once it admitted the proof: its custody notice.
        try {
          const opened = link.open(frame);
          const notice =
            opened.kind === 'owner' ? decodeRuntimeMessage(opened.plaintext) : undefined;
          if (notice?.op !== 'custody')
            throw new RangeError('The runtime did not announce its custody.');
          clearTimeout(timer);
          client = new RuntimeLinkClient(
            stream,
            link,
            notice.state,
            auth.mode === 'owner' ? auth.handover : undefined,
          );
          resolve(client);
          // The caller attaches its listeners as the open resolves; frames behind the notice wait for that.
          return 'yield';
        } catch {
          fail();
        }
      },
      onEnd: () => {
        clearTimeout(timer);
        if (client !== undefined) {
          client.end();
          return;
        }
        link?.close();
        // A refusal of the runtime's answer says which check failed; a close says nothing.
        reject(refusal instanceof KeyringError ? refusal : new OwnerLinkClosedError());
      },
    });
    stream.write(encodeLinkOpening(initiator.hello()));
  });
}

/**
 * Opens a spawner link on `stream`, already connected to the runtime's control endpoint, with the
 * key and instance key the spawner exchange gave. Rejects with `LinkRefusedError` when the runtime
 * is not the one the exchange started, before sending anything secret-derived, and with
 * `OwnerLinkClosedError` when the runtime closes or does not admit the link in time. Listeners
 * attached in the same tick the open resolves receive everything the runtime sends after its
 * custody notice.
 */
export async function openSpawnerLink(
  stream: Duplex,
  spawnerKey: SpawnerKey,
  instancePublicKey: Uint8Array,
  options: IOpenRuntimeLinkOptions = {},
): Promise<IRuntimeLinkClient> {
  return openRuntimeLink(stream, { mode: 'spawner', spawnerKey, instancePublicKey }, options);
}

/**
 * Opens an owner link on `stream` with the owner's handover. Rejects with `LinkRefusedError` when the
 * runtime shows no certificate the handover's attach key made for it (an impostor, a runtime nobody
 * certified, or one another keyring certified), before sending anything secret-derived. Listeners
 * attached in the same tick the open resolves receive everything the runtime sends after its
 * custody notice.
 */
export async function openOwnerLink(
  stream: Duplex,
  handover: IOwnerHandover,
  options: IOpenRuntimeLinkOptions = {},
): Promise<IOwnerRuntimeLinkClient> {
  return openRuntimeLink(stream, { mode: 'owner', handover }, options);
}
