import { randomBytes } from 'node:crypto';

import { afterAll, describe, vi } from 'vitest';

import { parseSubnetPool } from '../config.js';
import { ContainerRuntime } from '../runtime/container/backend.js';
import { EngineClient } from '../runtime/container/engine-client.js';
import { guardTableName } from '../runtime/container/guard-rules.js';
import { runHelper } from '../runtime/container/helper.js';
import { LABEL_INSTALL } from '../runtime/container/names.js';
import type { IRuntimePort, IUnitSpec } from '../runtime/port.js';
import { describeRuntimePortContract, unitSpecFor } from '../runtime/testing/contract.js';

/**
 * The contract suite against a real engine. Opt in with PERSONAL_AGENT_HOST_LIVE_ENGINE=1 and name
 * the images: PERSONAL_AGENT_HOST_LIVE_IMAGE (the agent image, built from docker/personal-agent) and
 * PERSONAL_AGENT_HOST_LIVE_GUARD_IMAGE (an image with the nft tool). It creates and removes real
 * containers, networks, volumes and one firewall table, all under a random install id. Run it once;
 * it is not part of CI.
 */
const LIVE = process.env.PERSONAL_AGENT_HOST_LIVE_ENGINE === '1';
const IMAGE = process.env.PERSONAL_AGENT_HOST_LIVE_IMAGE ?? 'personal-agent:local';
const GUARD_IMAGE =
  process.env.PERSONAL_AGENT_HOST_LIVE_GUARD_IMAGE ?? 'personal-agent-host-guard:local';
const ENDPOINT = process.env.PERSONAL_AGENT_HOST_LIVE_ENDPOINT ?? 'unix:///var/run/docker.sock';
const POOL = process.env.PERSONAL_AGENT_HOST_LIVE_POOL ?? '10.213.0.0/24';

const installId = randomBytes(4).toString('hex');
const pool = parseSubnetPool(POOL);
const SLOTS: Record<string, number> = { alpha: 0, beta: 1, nobody: 2 };

function spec(account: string): IUnitSpec {
  return unitSpecFor(account, {
    installId,
    image: IMAGE,
    subnetSlot: SLOTS[account] ?? 3,
    provider: { type: 'openai', model: 'live-contract-model', baseUrl: 'http://203.0.113.9/v1' },
  });
}

function runtime(): ContainerRuntime {
  if (typeof pool === 'string') throw new Error(pool);
  return new ContainerRuntime({
    engine: new EngineClient({ endpoint: ENDPOINT }),
    installId,
    subnetPool: pool,
    guardImage: GUARD_IMAGE,
    readyTimeoutMs: 120_000,
  });
}

/** Every unit gets a key, because the agent refuses to configure a provider without one. */
function withKey(port: IRuntimePort): IRuntimePort {
  return new Proxy(port, {
    get(target, property, receiver) {
      if (property === 'start') {
        return (unit: IUnitSpec, secrets: { modelApiKey?: string }) =>
          target.start(unit, { modelApiKey: 'live-contract-key-0123456789', ...secrets });
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

if (LIVE) {
  vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
  describeRuntimePortContract('container backend on the local engine', () => withKey(runtime()), {
    specFor: spec,
    makeUnverified: () => {
      if (typeof pool === 'string') throw new Error(pool);
      // A guard image that cannot apply a guard stands in for a host without the firewall.
      return new ContainerRuntime({
        engine: new EngineClient({ endpoint: ENDPOINT }),
        installId,
        subnetPool: pool,
        guardImage: 'alpine:3',
        readyTimeoutMs: 120_000,
      });
    },
  });

  afterAll(async () => {
    // Leave the engine as found: nothing labelled with this install, and no table of its.
    const engine = new EngineClient({ endpoint: ENDPOINT });
    const filters = JSON.stringify({ label: [`${LABEL_INSTALL}=${installId}`] });
    const containers = await engine.json<Array<{ Id: string }> | null>('GET', '/containers/json', {
      query: { all: '1', filters },
    });
    for (const c of containers ?? [])
      await engine.text('DELETE', `/containers/${c.Id}`, { query: { force: '1' } });
    const networks = await engine.json<Array<{ Id: string }> | null>('GET', '/networks', {
      query: { filters },
    });
    for (const n of networks ?? []) await engine.text('DELETE', `/networks/${n.Id}`);
    const volumes = await engine.json<{ Volumes?: Array<{ Name: string }> | null }>(
      'GET',
      '/volumes',
      { query: { filters } },
    );
    for (const v of volumes.Volumes ?? []) await engine.text('DELETE', `/volumes/${v.Name}`);
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
  }, 120_000);
} else {
  describe.skip('container backend on the local engine (set PERSONAL_AGENT_HOST_LIVE_ENGINE=1)', () =>
    undefined);
}
