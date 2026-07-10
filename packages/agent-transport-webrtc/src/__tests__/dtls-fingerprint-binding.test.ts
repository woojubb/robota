import { describe, expect, it } from 'vitest';
import { RTCPeerConnection } from 'werift';

/**
 * REMOTE-005 B3 TC-09 — the load-bearing premise behind the pairing channel-binding: werift's DTLS verifies the
 * negotiated remote certificate's fingerprint against the SDP-advertised value and FAILS the connection on a
 * mismatch (`verifyRemoteCertificateFingerprint`, RFC 8122). This is what guarantees a MITM relay cannot advertise
 * a fingerprint that differs from the cert it actually presents — so its advertised fingerprint necessarily
 * differs from the honest peer's, which the pairing confirmation detects.
 */

function tamperFingerprint(sdp: string): string {
  // Flip the advertised fingerprint to a value that will NOT match the real negotiated certificate.
  return sdp.replace(/a=fingerprint:(\S+) (\S+)/, (_m, hash: string) => {
    const bogus = Array.from({ length: 32 }, () => 'AA').join(':');
    return `a=fingerprint:${hash} ${bogus}`;
  });
}

describe('werift DTLS fingerprint verification (REMOTE-005 B3 — TC-09)', () => {
  it('fails the connection when the advertised remote fingerprint does not match the negotiated cert', async () => {
    const host = new RTCPeerConnection();
    const remote = new RTCPeerConnection();
    const dc = host.createDataChannel('robota-session');

    let opened = false;
    dc.stateChanged.subscribe((s) => {
      if (s === 'open') opened = true;
    });

    // Trickle ICE both ways (serialized on the remote side is unnecessary here — no answer-before-ICE issue since
    // we tamper the answer and expect DTLS to fail regardless).
    host.onIceCandidate.subscribe((c) => {
      if (c) void remote.addIceCandidate(c.toJSON());
    });
    remote.onIceCandidate.subscribe((c) => {
      if (c) void host.addIceCandidate(c.toJSON());
    });

    const offer = await host.createOffer();
    await host.setLocalDescription(offer);
    await remote.setRemoteDescription(host.localDescription!);
    const answer = await remote.createAnswer();
    await remote.setLocalDescription(answer);

    // MITM substitution: the host consumes an answer whose advertised fingerprint has been tampered.
    const tampered = {
      type: 'answer' as const,
      sdp: tamperFingerprint(remote.localDescription!.sdp),
    };
    await host.setRemoteDescription(tampered);

    // Give DTLS time to (fail to) establish; the data channel must NEVER open.
    await new Promise((r) => setTimeout(r, 4000));
    expect(opened).toBe(false);

    await host.close();
    await remote.close();
  }, 15000);
});
