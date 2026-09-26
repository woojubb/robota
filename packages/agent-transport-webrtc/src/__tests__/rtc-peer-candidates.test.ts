/**
 * An offering peer hands out its ICE candidates only once the answer is applied. With them earlier,
 * the answerer can reach this side and start DTLS while the answer is still being applied, and the
 * DTLS layer then refuses the peer's certificate for want of a fingerprint to check it against.
 */
import { describe, expect, it } from 'vitest';

import { RtcPeer } from '../rtc-peer.js';

import { fakeDataChannel } from './fake-datachannel.js';

describe('RtcPeer local candidates', () => {
  it('an offerer holds its candidates until the answer is applied, then hands them out in order', async () => {
    const fake = fakeDataChannel();
    const peer = new RtcPeer({ loadDataChannel: () => fake.module });
    const handedOut: string[] = [];
    peer.onLocalCandidate(({ candidate }) => handedOut.push(candidate));
    peer.createDataChannel('x');
    await peer.createOffer();
    const native = fake.connections[0]!;

    native.localCandidate!('a=candidate:1 1 UDP 1 10.0.0.1 1000 typ host', '0');
    native.localCandidate!('a=candidate:2 1 UDP 1 10.0.0.2 2000 typ host', '0');
    expect(handedOut).toEqual([]);

    peer.acceptAnswer('a=fingerprint:sha-256 BB');
    expect(handedOut).toEqual([
      'candidate:1 1 UDP 1 10.0.0.1 1000 typ host',
      'candidate:2 1 UDP 1 10.0.0.2 2000 typ host',
    ]);

    native.localCandidate!('a=candidate:3 1 UDP 1 10.0.0.3 3000 typ host', '0');
    expect(handedOut).toHaveLength(3);
    expect(peer.diagnostics().localCandidates).toBe(3);
    peer.close();
  });

  it('an answerer hands out its candidates as they come, the offer being applied already', async () => {
    const fake = fakeDataChannel();
    const peer = new RtcPeer({ loadDataChannel: () => fake.module });
    const handedOut: string[] = [];
    peer.onLocalCandidate(({ candidate }) => handedOut.push(candidate));
    await peer.acceptOffer('a=fingerprint:sha-256 AA');

    fake.connections[0]!.localCandidate!('a=candidate:1 1 UDP 1 10.0.0.1 1000 typ host', '0');
    expect(handedOut).toEqual(['candidate:1 1 UDP 1 10.0.0.1 1000 typ host']);
    peer.close();
  });

  it('a closed peer never hands out the candidates it held', async () => {
    const fake = fakeDataChannel();
    const peer = new RtcPeer({ loadDataChannel: () => fake.module });
    const handedOut: string[] = [];
    peer.onLocalCandidate(({ candidate }) => handedOut.push(candidate));
    await peer.createOffer();
    fake.connections[0]!.localCandidate!('a=candidate:1 1 UDP 1 10.0.0.1 1000 typ host', '0');
    peer.close();
    peer.acceptAnswer('a=fingerprint:sha-256 BB');
    expect(handedOut).toEqual([]);
  });
});
