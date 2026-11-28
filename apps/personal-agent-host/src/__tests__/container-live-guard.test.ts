import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { parseSubnetPool } from '../config.js';
import { ContainerRuntime } from '../runtime/container/backend.js';
import { EngineClient } from '../runtime/container/engine-client.js';
import { guardTableName } from '../runtime/container/guard-rules.js';
import { runHelper } from '../runtime/container/helper.js';
import { unitSpecFor } from '../runtime/testing/contract.js';

/**
 * The guard against real traffic on a real engine: each block is paired with a control that
 * succeeds, so a block cannot be a probe that never worked. Opt in with
 * PERSONAL_AGENT_HOST_LIVE_ENGINE=1; it needs the docker CLI, the guard image
 * (PERSONAL_AGENT_HOST_LIVE_GUARD_IMAGE) and an alpine image. It adds and removes one firewall table
 * of its own, and is not part of CI.
 */
const LIVE = process.env.PERSONAL_AGENT_HOST_LIVE_ENGINE === '1';
const GUARD_IMAGE =
  process.env.PERSONAL_AGENT_HOST_LIVE_GUARD_IMAGE ?? 'personal-agent-host-guard:local';
const PROBE_IMAGE = process.env.PERSONAL_AGENT_HOST_LIVE_PROBE_IMAGE ?? 'alpine:3.22';
const ENDPOINT = process.env.PERSONAL_AGENT_HOST_LIVE_ENDPOINT ?? 'unix:///var/run/docker.sock';
const POOL = process.env.PERSONAL_AGENT_HOST_LIVE_POOL ?? '10.213.0.0/24';

const installId = randomBytes(4).toString('hex');
const names: string[] = [];

function docker(...args: string[]): string {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 90_000,
    // The probes go to the same engine the backend is talking to.
    env: { ...process.env, DOCKER_HOST: ENDPOINT },
  }).trim();
}

function reaches(
  network: string,
  address: string,
  port: number,
  ip?: string,
  udp = false,
): boolean {
  try {
    docker(
      'run',
      '--rm',
      '--network',
      network,
      ...(ip ? ['--ip', ip] : []),
      PROBE_IMAGE,
      'nc',
      '-z',
      '-w',
      '4',
      ...(udp ? ['-u'] : []),
      address,
      String(port),
    );
    return true;
  } catch {
    return false;
  }
}

function listener(name: string, network: string, port: number, ip?: string): void {
  names.push(name);
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--network',
    network,
    ...(ip ? ['--ip', ip] : []),
    PROBE_IMAGE,
    'nc',
    '-lk',
    '-p',
    String(port),
    '-e',
    'true',
  );
}

describe.skipIf(!LIVE)('the guard on the local engine', () => {
  vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
  const pool = parseSubnetPool(POOL);
  if (typeof pool === 'string') throw new Error(pool);
  const engine = new EngineClient({ endpoint: ENDPOINT });
  const runtime = new ContainerRuntime({
    engine,
    installId,
    subnetPool: pool,
    guardImage: GUARD_IMAGE,
  });
  const spec = (account: string, slot: number) =>
    unitSpecFor(account, { installId, subnetSlot: slot });
  const netA = `pah-${installId}-alpha`;
  const netB = `pah-${installId}-beta`;

  afterAll(async () => {
    for (const name of names) {
      try {
        docker('rm', '-f', name);
      } catch {
        // already gone
      }
    }
    await runtime.destroy('alpha').catch(() => undefined);
    await runtime.destroy('beta').catch(() => undefined);
    await runHelper(
      engine,
      installId,
      {
        image: GUARD_IMAGE,
        entrypoint: [
          'sh',
          '-c',
          `nft delete table inet ${guardTableName(installId)} 2>/dev/null; true`,
        ],
        network: 'host',
        capAdd: ['NET_ADMIN'],
      },
      30_000,
    ).catch(() => undefined);
  });

  it('blocks what it must and leaves open what it must, each against a control', async () => {
    await runtime.provision(spec('alpha', 0));
    await runtime.provision(spec('beta', 1));
    const gateway = '10.213.0.1';
    const unitA = '10.213.0.2';
    const unitB = '10.213.0.10';
    listener(`pah-${installId}-b`, netB, 7360, unitB);
    listener(`pah-${installId}-host`, 'host', 9999);
    const hostAddress = docker(
      'run',
      '--rm',
      '--network',
      'host',
      PROBE_IMAGE,
      'sh',
      '-c',
      "ip -4 -o addr show scope global | head -1 | sed 's/.*inet \\([0-9.]*\\).*/\\1/'",
    );
    expect(hostAddress).toMatch(/^\d+\.\d+\.\d+\.\d+$/u);

    // Controls, before the guard exists: a unit can reach the host through its gateway and the
    // host's own address, and public DNS; the host reaches a unit.
    expect(reaches(netA, gateway, 9999, unitA)).toBe(true);
    expect(reaches(netA, hostAddress, 9999, unitA)).toBe(true);
    expect(reaches(netA, '1.1.1.1', 53, unitA)).toBe(true);
    expect(reaches('host', unitB, 7360)).toBe(true);

    const description = await runtime.describe();
    expect(description.guard.state).toBe('verified');

    // With the guard: the same probes, now blocked, while the host-side path still works.
    expect(reaches(netA, gateway, 9999, unitA)).toBe(false);
    expect(reaches(netA, hostAddress, 9999, unitA)).toBe(false);
    expect(reaches(netA, unitB, 7360, unitA)).toBe(false); // account A cannot reach account B
    expect(reaches('host', unitB, 7360)).toBe(true); // the host-side path can
    expect(reaches(netA, '1.1.1.1', 53, unitA)).toBe(false); // DNS only to the host's resolvers
    expect(reaches(netA, '169.254.169.254', 80, unitA)).toBe(false); // metadata address

    // The unit still has what it needs: name resolution and the public internet.
    expect(
      docker(
        'run',
        '--rm',
        '--network',
        netA,
        '--ip',
        unitA,
        PROBE_IMAGE,
        'sh',
        '-c',
        'nslookup example.com >/dev/null 2>&1 && wget -q -T 10 -O /dev/null https://example.com && echo ok',
      ),
    ).toBe('ok');
  });
});
