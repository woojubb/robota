/**
 * The remote fingerprint the pairing confirmation binds to, read from the certificate the DTLS layer verified.
 *
 * The SDP is delivered by an untrusted signaling path, and a DTLS stack accepts the remote certificate when it
 * matches ANY fingerprint the SDP advertises. Binding a value read from SDP text would therefore let the bound
 * fingerprint and the verified certificate differ. Reading the certificate itself, after the DTLS layer has
 * verified it, makes the binding and the connection share one source of truth.
 */

import { createHash } from 'node:crypto';

import type { RTCPeerConnection } from 'werift';

const HASHES: Readonly<Record<string, string>> = {
  'sha-256': 'sha256',
  'sha-384': 'sha384',
  'sha-512': 'sha512',
};

/** SDP-form fingerprint (`AB:CD:…`, upper case) of a DER certificate. Throws on an unsupported algorithm. */
export function certificateFingerprint(der: Uint8Array, algorithm: string): string {
  const hash = HASHES[algorithm.toLowerCase()];
  if (!hash) throw new Error(`unsupported DTLS fingerprint algorithm: ${algorithm}`);
  const hex = createHash(hash).update(der).digest('hex').toUpperCase();
  return hex.match(/../g)?.join(':') ?? '';
}

/**
 * Call `onVerified` with the remote certificate's fingerprint once the DTLS handshake — including its own
 * fingerprint check — has completed, or `onFailed` if the handshake fails or closes first, or the certificate
 * cannot be read. Returns an unsubscribe function.
 *
 * werift moves the DTLS transport to `connected` only after `verifyRemoteCertificateFingerprint` succeeds, and
 * the data channel runs over that DTLS session, so no channel frame can precede this callback.
 */
export function whenRemoteCertificateVerified(
  peer: RTCPeerConnection,
  algorithm: string,
  onVerified: (fingerprint: string) => void,
  onFailed: (reason: string) => void,
): () => void {
  const dtlsTransport = peer.sctpTransport?.dtlsTransport;
  if (!dtlsTransport) {
    onFailed('no DTLS transport for the data channel');
    return () => undefined;
  }
  let done = false;
  const settle = (): void => {
    if (done) return;
    const der = dtlsTransport.dtls?.remoteCertificate;
    done = true;
    if (!der) {
      onFailed('the DTLS layer exposed no remote certificate');
      return;
    }
    try {
      onVerified(certificateFingerprint(der, algorithm));
    } catch (error) {
      onFailed(error instanceof Error ? error.message : String(error));
    }
  };
  if (dtlsTransport.state === 'connected') {
    settle();
    return () => undefined;
  }
  const subscription = dtlsTransport.onStateChange.subscribe((state) => {
    if (state === 'connected') settle();
    else if (state === 'failed' || state === 'closed') {
      if (done) return;
      done = true;
      onFailed(`the DTLS handshake ended ${state}`);
    } else return;
    subscription.unSubscribe();
  });
  return () => subscription.unSubscribe();
}
