import { derivePairRendezvous, type IPairRendezvous } from '@robota-sdk/agent-remote-pairing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  MAX_RELAY_CREDENTIAL_TTL_MS,
  MeshTurnRelay,
  meshRelayCredential,
  meshRelayIceServers,
} from '../mesh-turn-relay.js';
import { buildMeshWorld, type IMeshTestDevice, type IMeshTestWorld } from './mesh-fixtures.js';
import { TurnTestClient } from './turn-test-client.js';

let world: IMeshTestWorld;
let stranger: IMeshTestDevice;
const relays: MeshTurnRelay[] = [];
const clients: TurnTestClient[] = [];

beforeAll(async () => {
  world = await buildMeshWorld();
  // A device of the same user that the lists in force do not name.
  stranger = (await buildMeshWorld()).third;
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const relay of relays.splice(0)) await relay.close();
});

/** `own`'s rendezvous with `peer`, under the world's lists or the ones given. */
function pair(
  own: IMeshTestDevice,
  peer: IMeshTestDevice,
  devices: readonly IMeshTestDevice[] = [world.low, world.high, world.third],
): Promise<IPairRendezvous> {
  return derivePairRendezvous({
    ownKaPrivateKey: own.ka.privateKey,
    own: own.cert,
    peerDeviceId: peer.cert.deviceId,
    lists: {
      roster: { devices: devices.map((d) => d.cert) },
      revocation: { revokedDeviceIds: [] },
    },
  });
}

/** `third` runs the relay for `low` and `high`. */
async function relayOnThird(now: () => number = Date.now): Promise<MeshTurnRelay> {
  const relay = await MeshTurnRelay.start({ host: '127.0.0.1', port: 0, now });
  relays.push(relay);
  relay.declarePeers([
    { deviceId: world.low.cert.deviceId, rendezvous: await pair(world.third, world.low) },
    { deviceId: world.high.cert.deviceId, rendezvous: await pair(world.third, world.high) },
  ]);
  return relay;
}

async function client(
  relay: MeshTurnRelay,
  credential: { readonly username: string; readonly credential: string },
): Promise<TurnTestClient> {
  const created = await TurnTestClient.connect(
    { address: relay.endpoint.host, port: relay.endpoint.port },
    credential.username,
    credential.credential,
  );
  clients.push(created);
  return created;
}

describe('embedded TURN relay — pairwise, short-lived credentials', () => {
  it('a roster device allocates with the credential it derives for the pair; the username names no device', async () => {
    const relay = await relayOnThird();
    const credential = await meshRelayCredential(await pair(world.low, world.third), Date.now());
    expect(credential.username).toMatch(/^\d+:[A-Za-z0-9_-]{22}$/);
    expect(credential.username).not.toContain(world.low.cert.deviceId.slice(0, 8));

    const answer = await (await client(relay, credential)).allocate();

    expect(answer.ok).toBe(true);
    expect(relay.allocationCount(world.low.cert.deviceId)).toBe(1);
    expect(relay.allocationCount(world.high.cert.deviceId)).toBe(0);
  });

  it('ICE servers carry the credential for every advertised endpoint of the relay', async () => {
    const servers = await meshRelayIceServers(
      await pair(world.low, world.third),
      [
        { host: '192.0.2.1', port: 3478 },
        { host: '2001:db8::1', port: 3479 },
      ],
      Date.now(),
    );
    expect(servers.map((s) => s.urls)).toEqual([
      'turn:192.0.2.1:3478?transport=udp',
      'turn:[2001:db8::1]:3479?transport=udp',
    ]);
    expect(new Set(servers.map((s) => s.username)).size).toBe(1);
  });

  it('a device outside the roster is refused, even with a genuine pairwise secret', async () => {
    const relay = await relayOnThird();
    // The stranger agrees a secret with the relay device under lists of its own making.
    const own = await pair(stranger, world.third, [world.third, stranger]);
    const answer = await (
      await client(relay, await meshRelayCredential(own, Date.now()))
    ).allocate();
    expect(answer.ok).toBe(false);
    expect(answer.code).toBe(401);
    expect(relay.allocationCount()).toBe(0);
  });

  it("another pair's credential, or a wrong password, is refused", async () => {
    const relay = await relayOnThird();
    // low's credential for its pair with high is not a credential for the relay device.
    const other = await meshRelayCredential(await pair(world.low, world.high), Date.now());
    expect((await (await client(relay, other)).allocate()).code).toBe(401);
    const right = await meshRelayCredential(await pair(world.low, world.third), Date.now());
    const wrong = await client(relay, { username: right.username, credential: 'x'.repeat(43) });
    expect((await wrong.allocate()).code).toBe(401);
    expect(relay.allocationCount()).toBe(0);
  });

  it('an expired credential, or one that claims to live longer than a relay accepts, is refused', async () => {
    let now = Date.now();
    const relay = await relayOnThird(() => now);
    const rendezvous = await pair(world.low, world.third);
    const expiring = await meshRelayCredential(rendezvous, now, 60_000);
    now += 61_000;
    expect((await (await client(relay, expiring)).allocate()).code).toBe(401);

    // Minted by hand past the longest lifetime (meshRelayCredential clamps it).
    const tag = (await meshRelayCredential(rendezvous, now)).username.split(':')[1]!;
    const username = `${Math.floor((now + MAX_RELAY_CREDENTIAL_TTL_MS + 5 * 60_000) / 1000)}:${tag}`;
    const longLived = {
      username,
      credential: await rendezvous.relayPassword('outbound', username),
    };
    expect((await (await client(relay, longLived)).allocate()).code).toBe(401);
    expect(relay.allocationCount()).toBe(0);
  });

  it("a revoked device's credential stops working and its allocations close at once", async () => {
    const relay = await relayOnThird();
    const credential = await meshRelayCredential(await pair(world.high, world.third), Date.now());
    const allocated = await client(relay, credential);
    expect((await allocated.allocate()).ok).toBe(true);

    // The lists in force now revoke high: only low stays a peer of the relay.
    relay.declarePeers([
      { deviceId: world.low.cert.deviceId, rendezvous: await pair(world.third, world.low) },
    ]);

    expect(relay.allocationCount(world.high.cert.deviceId)).toBe(0);
    // Nothing is left to refresh, and the credential no longer authenticates anything.
    expect((await allocated.refresh(600)).code).toBe(401);
    const again = await client(relay, credential);
    expect((await again.allocate()).code).toBe(401);
  });
});
