import { afterEach, describe, expect, it } from 'vitest';

import { StunAttr } from '../stun-message.js';
import { TurnServer, type ITurnServerOptions } from '../turn-server.js';
import { TurnTestClient, lifetimeOf, relayedAddress, udpPeer } from './turn-test-client.js';

const servers: TurnServer[] = [];
const closers: (() => void)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) close();
  for (const server of servers.splice(0)) await server.close();
});

async function serve(over: Partial<ITurnServerOptions> = {}): Promise<TurnServer> {
  const server = await TurnServer.start({
    host: '127.0.0.1',
    port: 0,
    authorize: (username) =>
      Promise.resolve(
        username.startsWith('user-') ? { owner: username.slice(5, 6), password: 'pw' } : undefined,
      ),
    ...over,
  });
  servers.push(server);
  return server;
}

async function client(
  server: TurnServer,
  username: string,
  password = 'pw',
): Promise<TurnTestClient> {
  const created = await TurnTestClient.connect(server.address, username, password);
  closers.push(() => created.close());
  return created;
}

async function peer(): Promise<Awaited<ReturnType<typeof udpPeer>>> {
  const created = await udpPeer();
  closers.push(() => created.close());
  return created;
}

describe('TURN server (RFC 8656 over UDP)', () => {
  it('relays both ways: Send/Data indications, then ChannelData once a channel is bound', async () => {
    const server = await serve();
    const turn = await client(server, 'user-a1');
    const allocated = await turn.allocate();
    expect(allocated.ok).toBe(true);
    const relayed = relayedAddress(allocated)!;
    expect(relayed.address).toBe('127.0.0.1');
    const remote = await peer();

    // Nothing is relayed to or from a peer without a permission.
    turn.sendTo(remote.address, Buffer.from('early'));
    remote.send(relayed, Buffer.from('unasked'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(remote.received).toEqual([]);
    expect(turn.received()).toEqual([]);

    expect((await turn.permit(remote.address)).ok).toBe(true);
    turn.sendTo(remote.address, Buffer.from('to peer'));
    await expect.poll(() => remote.received.map(String)).toEqual(['to peer']);
    remote.send(relayed, Buffer.from('to client'));
    await expect.poll(() => turn.received().map((d) => String(d.payload))).toEqual(['to client']);
    expect(turn.received()[0]!.from).toEqual(remote.address);

    expect((await turn.bindChannel(0x4001, remote.address)).ok).toBe(true);
    turn.sendOnChannel(0x4001, Buffer.from('channel out'));
    await expect.poll(() => remote.received.map(String)).toContain('channel out');
    remote.send(relayed, Buffer.from('channel in'));
    await expect
      .poll(() => turn.received().map((d) => `${d.from.port}:${String(d.payload)}`))
      .toContain(`${0x4001}:channel in`);
  });

  it('refuses what it does not do rather than half-doing it', async () => {
    const server = await serve();
    const turn = await client(server, 'user-a1');
    expect((await turn.allocate([], 6)).code).toBe(442); // TCP relaying
    expect(
      (await turn.allocate([{ type: StunAttr.EvenPort, value: Buffer.from([0x80, 0, 0, 0]) }]))
        .code,
    ).toBe(420);
    expect(
      (
        await turn.allocate([
          { type: StunAttr.RequestedAddressFamily, value: Buffer.from([2, 0, 0, 0]) },
        ])
      ).code,
    ).toBe(440);
    expect((await turn.allocate()).ok).toBe(true);
    // One allocation per 5-tuple.
    expect((await turn.allocate()).code).toBe(437);
    // Multicast is never a peer; loopback is only because this relay is on loopback.
    expect((await turn.permit({ address: '224.0.0.251', port: 5353 })).code).toBe(403);
    expect((await turn.bindChannel(0x3fff, { address: '127.0.0.1', port: 9 })).code).toBe(400);
  });

  it('an unknown username or a wrong password gets no allocation', async () => {
    const server = await serve();
    expect((await (await client(server, 'nobody')).allocate()).code).toBe(401);
    expect((await (await client(server, 'user-a1', 'wrong')).allocate()).code).toBe(401);
    expect(server.allocationCount()).toBe(0);
  });
});

describe('TURN server — quotas', () => {
  it('allocations per owner, and in all', async () => {
    const server = await serve({ quotas: { allocationsPerOwner: 2, totalAllocations: 3 } });
    for (const name of ['user-a1', 'user-a2']) {
      expect((await (await client(server, name)).allocate()).ok).toBe(true);
    }
    expect((await (await client(server, 'user-a3')).allocate()).code).toBe(486);
    expect((await (await client(server, 'user-b1')).allocate()).ok).toBe(true);
    expect((await (await client(server, 'user-c1')).allocate()).code).toBe(508);
    expect(server.allocationCount('a')).toBe(2);
  });

  it('relayed bytes per owner per second: what exceeds the budget is dropped', async () => {
    const server = await serve({ quotas: { bytesPerSecondPerOwner: 1_000 } });
    const turn = await client(server, 'user-a1');
    expect((await turn.allocate()).ok).toBe(true);
    const remote = await peer();
    expect((await turn.permit(remote.address)).ok).toBe(true);
    for (let i = 0; i < 10; i += 1) turn.sendTo(remote.address, Buffer.alloc(400, i));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(remote.received).toHaveLength(2);
  });

  it('lifetime: a grant never exceeds the quota, and an allocation never outlives its age limit', async () => {
    let now = Date.now();
    const server = await serve({
      now: () => now,
      quotas: { maxLifetimeSeconds: 60, maxAllocationAgeMs: 90_000 },
    });
    const turn = await client(server, 'user-a1');
    const allocated = await turn.allocate([
      { type: StunAttr.Lifetime, value: Buffer.from([0, 0, 0x0e, 0x10]) },
    ]);
    expect(lifetimeOf(allocated)).toBe(60);
    now += 50_000;
    // 40 s of age are left; the refresh grants no more.
    expect(lifetimeOf(await turn.refresh(3600))).toBe(40);
    now += 41_000;
    // Expired: refreshing now finds nothing of its own.
    expect((await turn.refresh(3600)).ok).toBe(false);
    expect(server.allocationCount()).toBe(0);
  });

  it('retain: an owner no longer named loses its allocations and cannot allocate again', async () => {
    const server = await serve();
    const turn = await client(server, 'user-a1');
    expect((await turn.allocate()).ok).toBe(true);
    server.retain(new Set(['b']));
    expect(server.allocationCount()).toBe(0);
    expect((await (await client(server, 'user-a2')).allocate()).code).toBe(403);
  });
});
