/**
 * The remote fingerprint a channel binding names: the one of the certificate the DTLS layer accepted,
 * never SDP text.
 *
 * The SDP arrives over an untrusted signaling path. The DTLS layer (OpenSSL, through libdatachannel)
 * accepts the remote certificate only after the peer has signed its handshake with that certificate's
 * key and the certificate matches the fingerprint of the remote description. Callers additionally
 * require the description to advertise exactly one fingerprint, so the accepted certificate and the
 * bound value cannot differ: binding it names the one party that holds the key.
 */

import type { RtcPeer } from './rtc-peer.js';

const FINGERPRINT_VALUE = /^[0-9A-F]{2}(?::[0-9A-F]{2})+$/;

/**
 * Call `onVerified` with the remote certificate's fingerprint once the connection is established, or
 * `onFailed` if it fails or closes first, or the fingerprint is missing or of another algorithm than
 * `algorithm`. Returns an unsubscribe function.
 *
 * The connection reports `connected` only after DTLS has completed, and the data channel runs over that
 * DTLS session.
 */
export function whenRemoteCertificateVerified(
  peer: RtcPeer,
  algorithm: string,
  onVerified: (fingerprint: string) => void,
  onFailed: (reason: string) => void,
): () => void {
  let done = false;
  const settle = (): void => {
    if (done) return;
    done = true;
    const fingerprint = peer.remoteFingerprint();
    if (fingerprint === undefined) {
      onFailed('the DTLS layer exposed no remote certificate');
      return;
    }
    const value = fingerprint.value.toUpperCase();
    if (fingerprint.algorithm.toLowerCase() !== algorithm.toLowerCase()) {
      onFailed(
        `the remote certificate was checked with ${fingerprint.algorithm}, not ${algorithm}`,
      );
      return;
    }
    if (!FINGERPRINT_VALUE.test(value)) {
      onFailed('the remote certificate fingerprint is malformed');
      return;
    }
    onVerified(value);
  };
  const fail = (state: string): void => {
    if (done) return;
    done = true;
    onFailed(`the connection ended ${state} before DTLS completed`);
  };
  if (peer.state === 'connected') {
    settle();
    return () => undefined;
  }
  if (peer.state === 'failed' || peer.state === 'closed') {
    fail(peer.state);
    return () => undefined;
  }
  const unsubscribe = peer.onStateChange((state) => {
    if (state === 'connected') settle();
    else if (state === 'failed' || state === 'closed') fail(state);
    else return;
    unsubscribe();
  });
  return unsubscribe;
}
