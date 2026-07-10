/**
 * Pairing handshake (REMOTE-005 Stage B3) — transport-agnostic protocol run over the WebRTC data channel BEFORE
 * any session is exposed. It drives the directional, nonce-bound channel-confirmation exchange and resolves
 * **accept** only after the counterpart's confirmation is verified; on mismatch/timeout it **hard-rejects** so the
 * caller closes the channel (no silent pass — fail closed). B4 wires this so a session handler cannot be attached
 * until `run()` resolves accept.
 *
 * Isomorphic (WebCrypto only). The caller supplies the data-channel `send`, feeds inbound frames via `onFrame`,
 * and passes the **werift-verified** remote fingerprint (from the SDP werift consumed) as the binding value.
 */
import {
  computeConfirmations,
  deriveSessionKey,
  generateNonce,
  verifyPeerConfirmation,
  type TPairingRole,
} from './pairing.js';

/** Handshake wire frames (namespaced so they can share the data channel with nothing else pre-session). */
export type TPairingFrame =
  | { readonly t: 'pair-nonce'; readonly nonce: string }
  | { readonly t: 'pair-confirm'; readonly mac: string };

export interface IPairingHandshakeOptions {
  readonly secret: string;
  /** Initiator ≡ the WebRTC offerer (fixed by signaling). */
  readonly role: TPairingRole;
  readonly localFingerprint: string;
  /** The remote DTLS fingerprint from the SDP werift consumed + verified. */
  readonly remoteFingerprint: string;
  /** Send a handshake frame over the data channel. */
  readonly send: (frame: TPairingFrame) => void;
  /** Reject if the handshake does not complete within this many ms (default 10s). Fail closed. */
  readonly timeoutMs?: number;
}

export interface IPairingResult {
  /** Domain-separated session key (base64url) for Stage-E use. */
  readonly sessionKey: string;
}

interface IPairingController {
  /** Resolves accept (with the session key) or rejects (caller must close the channel). */
  readonly result: Promise<IPairingResult>;
  /** Feed one inbound frame from the data channel. */
  onFrame(frame: TPairingFrame): void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Start a pairing handshake. Emits this peer's nonce immediately; once both nonces are known it sends its
 * confirmation; once the peer's confirmation arrives it verifies and resolves. The returned promise is the
 * **only** accept signal — the caller MUST await it before exposing any session, and MUST close the channel if it
 * rejects.
 */
export function startPairingHandshake(options: IPairingHandshakeOptions): IPairingController {
  const localNonce = generateNonce();
  let peerNonce: string | undefined;
  let expectPeer: string | undefined;
  let peerMac: string | undefined;
  let settled = false;

  let resolve!: (value: IPairingResult) => void;
  let reject!: (error: Error) => void;
  const result = new Promise<IPairingResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const timer = setTimeout(
    () => fail('pairing handshake timed out'),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  function fail(message: string): void {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    reject(new Error(message));
  }

  function succeed(sessionKey: string): void {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve({ sessionKey });
  }

  function nonces(): { nonceInitiator: string; nonceResponder: string } {
    // Canonical ordering: initiator's nonce first, regardless of which side we are.
    const own = { initiator: localNonce, responder: peerNonce } as Record<
      TPairingRole,
      string | undefined
    >;
    if (options.role === 'responder') {
      own.initiator = peerNonce;
      own.responder = localNonce;
    }
    return { nonceInitiator: own.initiator as string, nonceResponder: own.responder as string };
  }

  async function maybeSendConfirmation(): Promise<void> {
    if (peerNonce === undefined || expectPeer !== undefined) return;
    const { nonceInitiator, nonceResponder } = nonces();
    const { send, expectPeer: expected } = await computeConfirmations({
      secret: options.secret,
      role: options.role,
      nonceInitiator,
      nonceResponder,
      localFingerprint: options.localFingerprint,
      remoteFingerprint: options.remoteFingerprint,
    });
    expectPeer = expected;
    options.send({ t: 'pair-confirm', mac: send });
    await maybeVerify();
  }

  async function maybeVerify(): Promise<void> {
    if (settled || expectPeer === undefined || peerMac === undefined) return;
    const ok = await verifyPeerConfirmation(expectPeer, peerMac);
    if (!ok) {
      fail('pairing rejected: channel-confirmation mismatch (possible MITM relay)');
      return;
    }
    succeed(await deriveSessionKey(options.secret));
  }

  options.send({ t: 'pair-nonce', nonce: localNonce });

  return {
    result,
    onFrame(frame: TPairingFrame): void {
      if (settled) return;
      if (frame.t === 'pair-nonce') {
        if (peerNonce !== undefined) return; // ignore duplicates
        peerNonce = frame.nonce;
        void maybeSendConfirmation();
      } else if (frame.t === 'pair-confirm') {
        if (peerMac !== undefined) return;
        peerMac = frame.mac;
        void maybeVerify();
      }
    },
  };
}
