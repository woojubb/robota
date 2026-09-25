import { extractDtlsFingerprint } from '@robota-sdk/agent-remote-pairing';
import { describe, expect, it } from 'vitest';
import { RTCPeerConnection } from 'werift';

import { certificateFingerprint, whenRemoteCertificateVerified } from '../negotiated-certificate.js';

/** Connect two real werift peers directly and return them once the offerer's DTLS is connected. */
async function connectedPair(): Promise<{ host: RTCPeerConnection; remote: RTCPeerConnection }> {
  const host = new RTCPeerConnection();
  const remote = new RTCPeerConnection();
  host.createDataChannel('robota-session');
  host.onIceCandidate.subscribe((c) => {
    if (c) void remote.addIceCandidate(c.toJSON());
  });
  remote.onIceCandidate.subscribe((c) => {
    if (c) void host.addIceCandidate(c.toJSON());
  });
  await host.setLocalDescription(await host.createOffer());
  await remote.setRemoteDescription(host.localDescription!);
  await remote.setLocalDescription(await remote.createAnswer());
  await host.setRemoteDescription(remote.localDescription!);
  return { host, remote };
}

describe('negotiated certificate fingerprint', () => {
  it('reports the fingerprint of the certificate the DTLS layer verified', async () => {
    const { host, remote } = await connectedPair();
    const fingerprint = await new Promise<string>((resolve, reject) => {
      whenRemoteCertificateVerified(host, 'sha-256', resolve, (reason) => reject(new Error(reason)));
    });
    expect(fingerprint).toBe(extractDtlsFingerprint(remote.localDescription!.sdp));
    await host.close();
    await remote.close();
  }, 15000);

  it('fails on an algorithm it cannot hash', async () => {
    const { host, remote } = await connectedPair();
    const reason = await new Promise<string>((resolve) => {
      whenRemoteCertificateVerified(host, 'md5', () => resolve('verified'), resolve);
    });
    expect(reason).toMatch(/unsupported DTLS fingerprint algorithm/);
    await host.close();
    await remote.close();
  }, 15000);

  it('formats a digest as upper-case colon-separated pairs', () => {
    expect(certificateFingerprint(new Uint8Array([1, 2, 3]), 'SHA-256')).toMatch(
      /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/,
    );
  });
});

describe('negotiated certificate — failed handshake', () => {
  it('reports a DTLS handshake that fails instead of waiting forever', async () => {
    const host = new RTCPeerConnection();
    const remote = new RTCPeerConnection();
    host.createDataChannel('robota-session');
    host.onIceCandidate.subscribe((c) => {
      if (c) void remote.addIceCandidate(c.toJSON());
    });
    remote.onIceCandidate.subscribe((c) => {
      if (c) void host.addIceCandidate(c.toJSON());
    });
    await host.setLocalDescription(await host.createOffer());
    await remote.setRemoteDescription(host.localDescription!);
    await remote.setLocalDescription(await remote.createAnswer());
    // The host is told a fingerprint the remote's certificate does not have.
    const bogus = Array.from({ length: 32 }, () => 'AA').join(':');
    await host.setRemoteDescription({
      type: 'answer',
      sdp: remote.localDescription!.sdp.replace(/a=fingerprint:(\S+) (\S+)/, `a=fingerprint:$1 ${bogus}`),
    });
    const reason = await new Promise<string>((resolve) => {
      whenRemoteCertificateVerified(host, 'sha-256', () => resolve('verified'), resolve);
    });
    expect(reason).toMatch(/DTLS handshake ended (failed|closed)/);
    await host.close();
    await remote.close();
  }, 20000);
});
