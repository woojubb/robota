/**
 * The runtime's end of an owner link: one connection the control endpoint routed here after the
 * link request line.
 *
 * The handshake admits a spawner only with a spawner-key proof and an owner only with an attach-key
 * proof; on any failure, a frame over its bound, or a handshake that does not finish in time, the
 * stream is closed without a word, so a program probing the socket learns nothing about why. Once
 * admitted, the link reports its standing to the runtime's `admit`, announces the custody state,
 * and routes what arrives: session frames to the session sink, owner requests to the desk and the
 * session decisions, grant frames (owner links only) to the desk as read keys. Decoding is strict;
 * a frame that does not decode ends the link before any port sees it.
 */
import type { Duplex } from 'node:stream';

import {
  LINK_FRAME_OVERHEAD_BYTES,
  LINK_GRANT_FRAME_BYTES,
  LINK_HELLO_BYTES,
  LINK_PROOF_MAX_BYTES,
  createLinkResponder,
  linkFrameKind,
  type IReadKeys,
  type IResponderLink,
  type IRuntimeIdentity,
  type ILinkBinding,
  type TLinkMode,
} from '@robota-sdk/agent-keyring';

import {
  OwnerRequestRefusedError,
  type ILinkSessionSink,
  type IOwnerLinkDesk,
  type IOwnerLinkSessions,
  type IRuntimeCustodyState,
} from './link-ports.js';
import { encodeLinkFrame, readLinkFrames } from './link-stream.js';
import {
  MAX_REQUESTS_IN_FLIGHT,
  OWNER_FRAME_MAX_BYTES,
  SESSION_FRAME_MAX_BYTES,
  SEALED_FRAME_MAX_BYTES,
} from './link-bounds.js';
import {
  decodeOwnerRequest,
  encodeRuntimeMessage,
  type TOwnerRequest,
  type TRuntimeMessage,
} from './owner-vocabulary.js';

/** A runtime gives up on a handshake that has not finished by then. */
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * How long a client has to take what is still queued for it once its runtime ended the link. Long
 * enough for a client that reads at all; a client that does not read is cut so it cannot hold the
 * socket (and the memory behind it) open by never taking its last frames.
 */
export const DEFAULT_CLOSE_FLUSH_TIMEOUT_MS = 5_000;

/** An admitted link, as the runtime holds it. */
export interface IAdmittedRuntimeLink {
  /** How the client was admitted: `spawner` by the spawner key, `owner` by the attach key. */
  readonly standing: TLinkMode;
  readonly binding: ILinkBinding;
  /** Whether the link has ended or the runtime has ended it (what is still queued is being delivered). */
  readonly closed: boolean;
  /** Sends one serialized session-protocol message; throws `RangeError` for one over the frame bound. */
  sendSession(data: string): void;
  /** Tells the client its runtime's custody state changed. */
  notifyCustody(state: IRuntimeCustodyState): void;
  /**
   * Bytes this link has accepted and its client has not yet taken, so the runtime can cut a client
   * that stopped reading as it would one on the plain attach socket. Zero once the link is gone.
   */
  pendingBytes(): number;
  /**
   * Ends the link after what is queued has been written, so an answer sent just before (the
   * `done` of a certification, say) is not lost; nothing more is sent or read, and a client that
   * does not take its queue within the flush grace is cut. Idempotent.
   */
  close(): void;
}

/** The runtime's answers for one admitted link. */
export interface IRuntimeLinkPorts {
  readonly desk: IOwnerLinkDesk;
  readonly sessions: IOwnerLinkSessions;
  readonly session: ILinkSessionSink;
}

export interface IRuntimeLinkDeps {
  readonly identity: IRuntimeIdentity;
  /** This runtime start, as its registration names it. */
  readonly binding: ILinkBinding;
  /** The bytes after the request line that arrived with it. */
  readonly rest?: Uint8Array;
  readonly handshakeTimeoutMs?: number;
  readonly closeFlushTimeoutMs?: number;
  /**
   * Called once the handshake admitted the client; the ports it returns serve that link. The opening
   * custody notice is always the first frame the client sees: whatever `admit` sends through the link
   * goes out right after it, in the order it was sent.
   */
  readonly admit: (link: IAdmittedRuntimeLink) => IRuntimeLinkPorts;
}

const textDecoder = new TextDecoder('utf-8', { fatal: true });
const textEncoder = new TextEncoder();

function refusalOf(error: unknown): { readonly code: string; readonly message: string } {
  return error instanceof OwnerRequestRefusedError
    ? { code: error.code, message: error.message }
    : { code: 'failed', message: 'The runtime could not do this.' };
}

/**
 * Serves one owner link on `stream`, which the control endpoint has read the request line from and
 * paused. Returns at once; the link lives until the stream closes.
 */
export function serveRuntimeLink(stream: Duplex, deps: IRuntimeLinkDeps): void {
  let responder: ReturnType<typeof createLinkResponder>;
  try {
    responder = createLinkResponder(deps.identity, deps.binding);
  } catch (error) {
    stream.destroy();
    throw error;
  }
  let step: 'hello' | 'proof' | 'linked' = 'hello';
  let link: IResponderLink | undefined;
  let ports: IRuntimeLinkPorts | undefined;
  let grants = 0;
  let inFlight = 0;
  const timer = setTimeout(
    () => stream.destroy(),
    deps.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
  );
  timer.unref?.();

  /**
   * What `admit` asked to send, as writes to run once the opening custody notice is out; `undefined`
   * outside that window. A frame's counter is taken when it is sealed, so the notice is sealed first.
   */
  let held: Array<() => void> | undefined;

  /** The runtime ended the link and the stream is writing out its queue: nothing more goes either way. */
  let closing = false;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  const sendSealed = (kind: 'session' | 'owner', bytes: Uint8Array): void => {
    const write = (): void => {
      if (link === undefined || link.closed || stream.destroyed || closing) return;
      stream.write(encodeLinkFrame(link.seal(kind, bytes)));
    };
    if (held !== undefined) held.push(write);
    else write();
  };

  const sendOwner = (message: TRuntimeMessage): void => {
    if (link === undefined || link.closed || stream.destroyed || closing) return;
    sendSealed('owner', encodeRuntimeMessage(message));
  };

  /** Whether one more request may wait; a peer that has more waiting than a client allows itself loses the link. */
  const admitRequest = (): boolean => {
    if (inFlight < MAX_REQUESTS_IN_FLIGHT) return true;
    stream.destroy();
    return false;
  };

  const reply = (requestId: string, work: () => Promise<TRuntimeMessage>): void => {
    inFlight += 1;
    void work()
      .then(
        (message) => message,
        (error: unknown): TRuntimeMessage => ({ op: 'refused', requestId, ...refusalOf(error) }),
      )
      .then((message) => {
        inFlight -= 1;
        try {
          sendOwner(message);
        } catch {
          // An answer outside the vocabulary (a too-long notice, say) reaches the client as a failure.
          sendOwner({ op: 'refused', requestId, ...refusalOf(undefined) });
        }
      })
      .catch(() => stream.destroy());
  };

  const dispatch = (request: TOwnerRequest, linked: IRuntimeLinkPorts): void => {
    const { requestId } = request;
    switch (request.op) {
      case 'install-trust-root':
        return reply(requestId, async () => {
          await linked.desk.installTrustRoot(request.root);
          return { op: 'done', requestId };
        });
      case 'lock':
        return reply(requestId, async () => {
          await linked.desk.lock(request.reason);
          return { op: 'done', requestId };
        });
      case 'question':
        return reply(requestId, async () => ({
          op: 'question',
          requestId,
          question: await linked.sessions.question(request.sessionId),
        }));
      case 'open-accepted':
        return reply(requestId, async () => {
          await linked.sessions.openAccepted(request.sessionId, request.acceptedDigest);
          return { op: 'done', requestId };
        });
      case 'control':
        return reply(requestId, async () => ({
          op: 'control',
          requestId,
          result: await linked.desk.control(request.request),
        }));
    }
  };

  const unlock = (keys: IReadKeys, linked: IRuntimeLinkPorts): void => {
    grants += 1;
    const requestId = `g${grants}`;
    reply(requestId, async () => {
      try {
        return { op: 'unlocked', requestId, sealingKey: await linked.desk.unlock(keys) };
      } catch (error) {
        keys.lock();
        throw error;
      }
    });
  };

  const onSealed = (frame: Uint8Array, linked: IRuntimeLinkPorts, open: IResponderLink): void => {
    const kind = linkFrameKind(frame);
    if (kind === 'grant') {
      if (frame.length !== LINK_GRANT_FRAME_BYTES) throw new RangeError('A grant has one size.');
      // Checked before the grant opens, so keys are never made for a request that cannot wait.
      if (!admitRequest()) return;
      unlock(open.openReadGrant(frame), linked);
      return;
    }
    const bound = kind === 'owner' ? OWNER_FRAME_MAX_BYTES : SESSION_FRAME_MAX_BYTES;
    if (frame.length > bound + LINK_FRAME_OVERHEAD_BYTES)
      throw new RangeError('A frame over its bound.');
    const { plaintext } = open.open(frame);
    if (kind === 'session') {
      linked.session.receive(textDecoder.decode(plaintext));
      return;
    }
    const request = decodeOwnerRequest(plaintext);
    if (request === undefined) throw new RangeError('A request outside the vocabulary.');
    if (admitRequest()) dispatch(request, linked);
  };

  const admitted: IAdmittedRuntimeLink = {
    get standing(): TLinkMode {
      return link!.standing;
    },
    binding: deps.binding,
    get closed(): boolean {
      return link === undefined || link.closed || stream.destroyed || closing;
    },
    sendSession(data: string): void {
      const bytes = textEncoder.encode(data);
      if (bytes.length > SESSION_FRAME_MAX_BYTES)
        throw new RangeError('A session message over the frame bound.');
      if (link === undefined || link.closed || stream.destroyed || closing) return;
      sendSealed('session', bytes);
    },
    notifyCustody(state: IRuntimeCustodyState): void {
      sendOwner({ op: 'custody', state: { unlocked: state.unlocked, certified: state.certified } });
    },
    pendingBytes(): number {
      return stream.destroyed ? 0 : stream.writableLength;
    },
    close(): void {
      if (closing || stream.destroyed) return;
      closing = true;
      // `end` flushes the queue; the stream is destroyed once it has, or once the grace is over.
      flushTimer = setTimeout(
        () => stream.destroy(),
        deps.closeFlushTimeoutMs ?? DEFAULT_CLOSE_FLUSH_TIMEOUT_MS,
      );
      flushTimer.unref?.();
      stream.end(() => stream.destroy());
    },
  };

  readLinkFrames(stream, {
    ...(deps.rest !== undefined ? { rest: deps.rest } : {}),
    maxBytes: () =>
      step === 'hello'
        ? LINK_HELLO_BYTES
        : step === 'proof'
          ? LINK_PROOF_MAX_BYTES
          : SEALED_FRAME_MAX_BYTES,
    onFrame: (frame) => {
      // Ended by the runtime: the client's last words are not heard.
      if (closing) return;
      try {
        if (step === 'hello') {
          stream.write(encodeLinkFrame(responder.challenge(frame)));
          step = 'proof';
          return;
        }
        if (step === 'proof') {
          link = responder.accept(frame).link;
          clearTimeout(timer);
          step = 'linked';
          const early: Array<() => void> = [];
          held = early;
          ports = deps.admit(admitted);
          const custody = ports.desk.custody();
          held = undefined;
          admitted.notifyCustody(custody);
          for (const write of early) write();
          return;
        }
        onSealed(frame, ports!, link!);
      } catch {
        // Refused, malformed or failed: the other end is told nothing.
        stream.destroy();
      }
    },
    onEnd: () => {
      clearTimeout(timer);
      if (flushTimer !== undefined) clearTimeout(flushTimer);
      link?.close();
      if (ports !== undefined) {
        try {
          ports.desk.closed();
        } catch {
          // allow-fallback: the link is already gone; a failing listener cannot bring it back.
        }
      }
    },
  });
}
