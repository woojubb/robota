import { afterEach, describe, expect, it } from 'vitest';

import { randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';

import {
  StunAttr,
  StunClass,
  StunMethod,
  attribute,
  decodeStun,
  encodeStun,
  readErrorCode,
} from '../stun-message.js';
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

  it('attributes appended after MESSAGE-INTEGRITY count for nothing', async () => {
    const server = await serve();
    const turn = await client(server, 'user-a1');
    expect((await turn.allocate()).ok).toBe(true);
    // A genuine Refresh asks for the default lifetime; an attacker on the path appends LIFETIME 0.
    const refreshed = await turn.request(StunMethod.Refresh, [], undefined, [
      { type: StunAttr.Lifetime, value: Buffer.alloc(4) },
    ]);
    expect(refreshed.ok).toBe(true);
    expect(lifetimeOf(refreshed)).toBe(600);
    expect(server.allocationCount()).toBe(1);
  });

  it("never relays into the server's own port", async () => {
    // A relay on loopback would otherwise let a client loop TURN into the server itself.
    const server = await serve();
    const turn = await client(server, 'user-a1');
    expect((await turn.allocate()).ok).toBe(true);
    expect((await turn.permit(server.address)).ok).toBe(true);
    const before = server.allocationCount();
    turn.sendTo(
      server.address,
      Buffer.from([0x00, 0x03, 0x00, 0x00, 0x21, 0x12, 0xa4, 0x42, ...Array<number>(12).fill(7)]),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    // The server's answer to itself would have come back as data from the server's own address.
    expect(turn.received()).toEqual([]);
    expect(server.allocationCount()).toBe(before);
  });

  it('takes relayed ports from the configured range, and refuses once it is used up', async () => {
    const probe = await udpPeer();
    const min = probe.address.port;
    probe.close();
    const server = await serve({ relayPorts: { min, max: min + 1 } });
    const ports: number[] = [];
    for (const name of ['user-a1', 'user-b1']) {
      const answer = await (await client(server, name)).allocate();
      expect(answer.ok).toBe(true);
      ports.push(relayedAddress(answer)!.port);
    }
    expect(ports.sort()).toEqual([min, min + 1]);
    expect((await (await client(server, 'user-c1')).allocate()).code).toBe(508);
  });

  it('private and link-local peers can be ruled out; they are allowed by default', async () => {
    const lan = { address: '192.168.1.20', port: 5000 };
    const open = await client(await serve(), 'user-a1');
    expect((await open.allocate()).ok).toBe(true);
    expect((await open.permit(lan)).ok).toBe(true);

    const closed = await client(await serve({ allowPrivatePeers: false }), 'user-a1');
    expect((await closed.allocate()).ok).toBe(true);
    for (const address of ['10.0.0.5', '172.16.4.4', '192.168.1.20', '169.254.1.1', '100.64.0.9']) {
      expect((await closed.permit({ address, port: 5000 })).code).toBe(403);
      expect((await closed.bindChannel(0x4002, { address, port: 5000 })).code).toBe(403);
    }
    expect((await closed.permit({ address: '203.0.113.9', port: 5000 })).ok).toBe(true);
  });

  it('an unknown username or a wrong password gets no allocation', async () => {
    const server = await serve();
    expect((await (await client(server, 'nobody')).allocate()).code).toBe(401);
    expect((await (await client(server, 'user-a1', 'wrong')).allocate()).code).toBe(401);
    expect(server.allocationCount()).toBe(0);
  });
});

describe('TURN server — requests nobody authenticated', () => {
  /** A raw datagram from a socket of its own; resolves with the answers it got. */
  async function probe(
    server: TurnServer,
    datagrams: readonly Buffer[],
  ): Promise<{ readonly answers: Buffer[] }> {
    const socket = createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
    closers.push(() => socket.close());
    const answers: Buffer[] = [];
    socket.on('message', (data) => answers.push(data));
    for (const datagram of datagrams) {
      socket.send(datagram, server.address.port, server.address.address);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { answers };
  }

  function allocateRequest(padding: number): Buffer {
    return encodeStun(StunMethod.Allocate, StunClass.Request, randomBytes(12), [
      { type: StunAttr.RequestedTransport, value: Buffer.from([17, 0, 0, 0]) },
      ...(padding > 0 ? [{ type: 0x8022, value: Buffer.alloc(padding, 0x61) }] : []),
    ]);
  }

  it('are never answered with more than they carry: the relay cannot amplify a forged source', async () => {
    const server = await serve();
    // A bare request is smaller than any challenge: it goes unanswered.
    const bare = allocateRequest(0);
    expect((await probe(server, [bare])).answers).toEqual([]);
    const bareBinding = encodeStun(StunMethod.Binding, StunClass.Request, randomBytes(12), [], {
      fingerprint: false,
    });
    expect((await probe(server, [bareBinding])).answers).toEqual([]);

    // One the size a WebRTC client sends gets its challenge, no larger than itself.
    const sized = allocateRequest(20);
    const { answers } = await probe(server, [sized]);
    expect(answers).toHaveLength(1);
    expect(answers[0]!.length).toBeLessThanOrEqual(sized.length);
    expect(readErrorCode(attribute(decodeStun(answers[0]!)!, StunAttr.ErrorCode))).toBe(401);
  });

  it('are answered at a limited rate per source address and in all; the rest are dropped', async () => {
    const burst = Array.from({ length: 10 }, () => allocateRequest(40));
    // Every probe here comes from 127.0.0.1, one source address whatever its port; the clock
    // stands still, so no budget refills between probes.
    const now = Date.now();
    const perSource = await serve({
      now: () => now,
      unauthenticatedLimits: { perSourcePerSecond: 3, totalPerSecond: 100 },
    });
    expect((await probe(perSource, burst)).answers).toHaveLength(3);
    expect((await probe(perSource, burst)).answers).toHaveLength(0);

    const inAll = await serve({
      now: () => now,
      unauthenticatedLimits: { perSourcePerSecond: 100, totalPerSecond: 4 },
    });
    expect((await probe(inAll, burst)).answers).toHaveLength(4);
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
