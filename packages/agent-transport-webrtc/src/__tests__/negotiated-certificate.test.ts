import { extractDtlsFingerprint } from '@robota-sdk/agent-remote-pairing';
import { describe, expect, it } from 'vitest';

import { whenRemoteCertificateVerified } from '../negotiated-certificate.js';
import { RtcPeer } from '../rtc-peer.js';

interface IPair {
  readonly host: RtcPeer;
  readonly remote: RtcPeer;
  readonly offer: string;
  readonly answer: string;
}

/** Connect two real peers directly; `tamperAnswer` rewrites the answer the host consumes. */
async function connectedPair(tamperAnswer: (sdp: string) => string = (sdp) => sdp): Promise<IPair> {
  const host = new RtcPeer();
  const remote = new RtcPeer();
  host.createDataChannel('robota-session');
  const toRemote: { candidate: string; mid: string }[] = [];
  const toHost: { candidate: string; mid: string }[] = [];
  host.onLocalCandidate((c) => toRemote.push(c));
  remote.onLocalCandidate((c) => toHost.push(c));
  const offer = await host.createOffer();
  const answer = await remote.acceptOffer(offer);
  host.acceptAnswer(tamperAnswer(answer));
  // Candidates keep arriving after the descriptions; deliver them for a while.
  const deliver = setInterval(() => {
    for (const c of toRemote.splice(0)) remote.addRemoteCandidate(c);
    for (const c of toHost.splice(0)) host.addRemoteCandidate(c);
  }, 20);
  setTimeout(() => clearInterval(deliver), 5_000).unref();
  return { host, remote, offer, answer };
}

function verified(peer: RtcPeer, algorithm = 'sha-256'): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    whenRemoteCertificateVerified(peer, algorithm, resolve, (reason) => reject(new Error(reason)));
  });
}

describe('negotiated certificate fingerprint', () => {
  it('reports the fingerprint of the certificate the DTLS layer accepted, on both sides', async () => {
    const { host, remote, offer, answer } = await connectedPair();
    await expect(verified(host)).resolves.toBe(extractDtlsFingerprint(answer));
    await expect(verified(remote)).resolves.toBe(extractDtlsFingerprint(offer));
    host.close();
    remote.close();
  }, 15_000);

  it('gives every connection a certificate of its own', async () => {
    const first = await connectedPair();
    const second = await connectedPair();
    const fingerprints = new Set(
      [first.offer, first.answer, second.offer, second.answer].map(extractDtlsFingerprint),
    );
    expect(fingerprints.size).toBe(4);
    for (const peer of [first.host, first.remote, second.host, second.remote]) peer.close();
  }, 15_000);

  it('fails when the certificate was checked with another algorithm than the description names', async () => {
    const { host, remote } = await connectedPair();
    await expect(verified(host, 'sha-384')).rejects.toThrow(/checked with sha-256, not sha-384/);
    host.close();
    remote.close();
  }, 15_000);

  it('reports a DTLS handshake that fails because the description names another certificate', async () => {
    const bogus = Array.from({ length: 32 }, () => 'AA').join(':');
    const { host, remote } = await connectedPair((sdp) =>
      sdp.replace(/a=fingerprint:(\S+) (\S+)/, `a=fingerprint:$1 ${bogus}`),
    );
    await expect(verified(host)).rejects.toThrow(/ended (failed|closed)/);
    host.close();
    remote.close();
  }, 30_000);
});
