import { afterEach, describe, expect, it } from 'vitest';

import { parseSubnetPool } from '../config.js';
import { ContainerRuntime } from '../runtime/container/backend.js';
import { EngineClient } from '../runtime/container/engine-client.js';
import { parseResolvers } from '../runtime/container/guard.js';
import { RuntimePortError, type IUnitSpec } from '../runtime/port.js';
import { describeRuntimePortContract, unitSpecFor } from '../runtime/testing/contract.js';
import { FakeEngine } from './fake-engine.js';
import { cleanTempDirs } from './harness.js';

const INSTALL = 'abcdef01';
const KEY = 'sk-unit-secret-4c9e1d7a02';
const SLOTS: Record<string, number> = { alpha: 0, beta: 1, nobody: 2, gamma: 3 };
const POOL = parseSubnetPool('10.200.0.0/16');
if (typeof POOL === 'string') throw new Error(POOL);

const engines: FakeEngine[] = [];

async function newEngine(): Promise<FakeEngine> {
  const fake = new FakeEngine();
  await fake.listen();
  fake.resolvConf = 'nameserver 192.0.2.53\nnameserver 127.0.0.11\n';
  engines.push(fake);
  return fake;
}

function runtimeOn(
  fake: FakeEngine,
  extra: Partial<ConstructorParameters<typeof ContainerRuntime>[0]> = {},
): ContainerRuntime {
  return new ContainerRuntime({
    engine: new EngineClient({ endpoint: fake.endpoint, timeoutMs: 2_000 }),
    installId: INSTALL,
    subnetPool: POOL as Exclude<typeof POOL, string>,
    guardImage: 'guard:test',
    readyTimeoutMs: 500,
    pollMs: 5,
    ...extra,
  });
}

function spec(account: string, overrides: Partial<IUnitSpec> = {}): IUnitSpec {
  return unitSpecFor(account, {
    installId: INSTALL,
    subnetSlot: SLOTS[account] ?? 5,
    provider: { type: 'openai', model: 'm', baseUrl: 'https://models.example.test/v1' },
    ...overrides,
  });
}

afterEach(async () => {
  await Promise.all(engines.splice(0).map((e) => e.close()));
  await cleanTempDirs();
});

// The shared behaviour of every backend, here against an engine that lives in this process.
describeRuntimePortContract(
  'container backend over a fake engine',
  async () => runtimeOn(await newEngine()),
  {
    makeUnverified: async () => {
      const fake = await newEngine();
      fake.guardApplyFailure = { code: 1, output: 'Error: Operation not supported' };
      return runtimeOn(fake);
    },
    specFor: spec,
  },
);

async function started(
  extra: Partial<ConstructorParameters<typeof ContainerRuntime>[0]> = {},
): Promise<{ fake: FakeEngine; runtime: ContainerRuntime }> {
  const fake = await newEngine();
  const runtime = runtimeOn(fake, extra);
  await runtime.provision(spec('alpha'));
  await runtime.start(spec('alpha'), { modelApiKey: KEY });
  return { fake, runtime };
}

const NAME = `pah-${INSTALL}-alpha`;

describe('the unit as the engine is asked to build it', () => {
  it('hardens and limits the container in every field', async () => {
    const { fake } = await started();
    const body = fake.container(NAME) as Record<string, any>;
    expect(body.Image).toBe('personal-agent:test');
    expect(body).not.toHaveProperty('User'); // the image's own user, never root
    expect(body).not.toHaveProperty('ExposedPorts');
    const host = body.HostConfig;
    expect(host.Privileged).toBe(false);
    expect(host.CapDrop).toEqual(['ALL']);
    expect(host).not.toHaveProperty('CapAdd');
    expect(host.SecurityOpt).toEqual(['no-new-privileges:true']);
    expect(host.ReadonlyRootfs).toBe(true);
    expect(host.Tmpfs).toEqual({ '/tmp': 'rw,nosuid,nodev,size=256m' });
    expect(host.Mounts).toEqual([
      { Type: 'volume', Source: `${NAME}-state`, Target: '/home/node/.personal' },
    ]);
    expect(host).not.toHaveProperty('Binds');
    expect(host.PublishAllPorts).toBe(false);
    expect(host.PortBindings).toEqual({});
    expect(host.Memory).toBe(512 * 1024 * 1024);
    expect(host.MemorySwap).toBe(host.Memory); // no swap
    expect(host.NanoCpus).toBe(1_000_000_000);
    expect(host.PidsLimit).toBe(128);
    expect(host.LogConfig).toEqual({
      Type: 'json-file',
      Config: { 'max-size': '10m', 'max-file': '3' },
    });
    expect(host.RestartPolicy).toEqual({ Name: 'no' });
    expect(host.NetworkMode).toBe(NAME);
    expect(host).not.toHaveProperty('PidMode');
    expect(host).not.toHaveProperty('Devices');
  });

  it('gives the unit a static address on its own network and a healthcheck on the app', async () => {
    const { fake } = await started();
    const body = fake.container(NAME) as Record<string, any>;
    expect(body.NetworkingConfig.EndpointsConfig[NAME].IPAMConfig.IPv4Address).toBe('10.200.0.2');
    expect(body.Env).toContain('PERSONAL_AGENT_INGRESS_ADDR=10.200.0.2');
    expect(body.Healthcheck.Test.slice(0, 3)).toEqual(['CMD', 'node', '-e']);
    expect(body.Healthcheck.Test[3]).toContain("path:'/'");
    expect(body.Healthcheck.Test[3]).toContain('7360');
    expect(body.Healthcheck.Interval).toBeGreaterThan(0);
    expect(body.Healthcheck.Retries).toBeGreaterThan(0);
  });

  it('creates a /29 bridge of its own, IPv4 only, with no traffic between containers', async () => {
    const { fake } = await started();
    expect(fake.network(NAME)).toMatchObject({
      Driver: 'bridge',
      EnableIPv6: false,
      Internal: false,
      CheckDuplicate: true,
      IPAM: { Config: [{ Subnet: '10.200.0.0/29', Gateway: '10.200.0.1' }] },
      Options: {
        'com.docker.network.bridge.name': 'pahabcdef000',
        'com.docker.network.bridge.enable_icc': 'false',
        'com.docker.network.bridge.enable_ip_masquerade': 'true',
      },
    });
  });

  it('puts the next account on the next /29 and a bridge name of its own', async () => {
    const fake = await newEngine();
    const runtime = runtimeOn(fake);
    await runtime.provision(spec('alpha'));
    await runtime.provision(spec('beta'));
    expect(fake.network(`pah-${INSTALL}-beta`)).toMatchObject({
      IPAM: { Config: [{ Subnet: '10.200.0.8/29', Gateway: '10.200.0.9' }] },
      Options: { 'com.docker.network.bridge.name': 'pahabcdef001' },
    });
    expect((await runtime.inspect('beta')).endpoints.host).toBe('10.200.0.10');
  });

  it('prefixes every object with the install id and labels it for listing', async () => {
    const { fake } = await started();
    const labels = {
      'robota.personal-agent-host.install': INSTALL,
      'robota.personal-agent-host.account': 'alpha',
      'robota.personal-agent-host.slot': '0',
      'robota.personal-agent-host.image': 'personal-agent:test',
      'robota.personal-agent-host.kind': 'unit',
    };
    expect(fake.containerNames()).toEqual([NAME]);
    expect(fake.networkNames()).toEqual([NAME]);
    expect(fake.volumeNames()).toEqual([`${NAME}-state`]);
    expect(fake.container(NAME)?.Labels).toEqual(labels);
    expect(fake.network(NAME)?.Labels).toEqual(labels);
    expect(fake.volume(`${NAME}-state`)).toEqual(labels);
  });

  it('tells the agent the provider, the public address and the name of the key variable', async () => {
    const { fake } = await started();
    const env = fake.container(NAME)?.Env as string[];
    expect(env).toEqual(
      expect.arrayContaining([
        'PERSONAL_AGENT_PUBLIC_URL=https://alpha.agents.example.test',
        'PERSONAL_AGENT_PROVIDER=openai',
        'PERSONAL_AGENT_MODEL=m',
        'PERSONAL_AGENT_BASE_URL=https://models.example.test/v1',
        'PERSONAL_AGENT_API_KEY_ENV=PERSONAL_AGENT_MODEL_API_KEY',
      ]),
    );
  });

  it('reports the unit running and healthy at its own address and the agent ports', async () => {
    const { runtime } = await started();
    expect(await runtime.inspect('alpha')).toEqual({
      account: 'alpha',
      state: 'running',
      healthy: true,
      endpoints: { host: '10.200.0.2', guiPort: 7360, wsPort: 7361 },
      keyConfigured: true,
    });
  });
});

describe('secrets', () => {
  it('reach the engine only inside the unit container environment, at start', async () => {
    const { fake } = await started();
    const bodies = fake.requests.filter((r) => JSON.stringify(r.body ?? null).includes(KEY));
    expect(bodies.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /containers/create']);
    const env = fake.container(NAME)?.Env as string[];
    expect(env).toContain(`PERSONAL_AGENT_MODEL_API_KEY=${KEY}`);
    expect(JSON.stringify([fake.network(NAME), fake.volume(`${NAME}-state`)])).not.toContain(KEY);
    // The key is in no path, query or label either.
    expect(fake.requests.map((r) => r.path).join(' ')).not.toContain(KEY);
  });

  it('leave with the container at stop, so a stopped unit holds none', async () => {
    const { fake, runtime } = await started();
    await runtime.stop('alpha');
    expect(fake.containerNames()).toEqual([]);
    expect(JSON.stringify(fake.requests.slice(-4))).not.toContain(KEY);
    expect(await runtime.inspect('alpha')).toMatchObject({
      state: 'stopped',
      keyConfigured: false,
    });
  });

  it('are absent from every answer', async () => {
    const { runtime } = await started();
    const shown = JSON.stringify([
      await runtime.describe(),
      await runtime.inspect('alpha'),
      await runtime.list(),
      await runtime.accessCode('alpha'),
    ]);
    expect(shown).not.toContain(KEY);
  });

  it('are scrubbed from an error an engine returns, and the half-made container is removed', async () => {
    const fake = await newEngine();
    const runtime = runtimeOn(fake);
    await runtime.provision(spec('alpha'));
    await runtime.describe(); // the guard is applied, so the next failure is the unit's own
    fake.failNext(
      /POST \/containers\/pah-abcdef01-alpha\/start/u,
      500,
      `cannot start with ${KEY} set`,
    );
    const error = (await runtime
      .start(spec('alpha'), { modelApiKey: KEY })
      .catch((e: unknown) => e)) as RuntimePortError;
    expect(error).toBeInstanceOf(RuntimePortError);
    expect(error.code).toBe('failed');
    expect(error.message).not.toContain(KEY);
    expect(error.message).toContain('[redacted]');
    expect(fake.containerNames()).toEqual([]);
  });

  it('are absent from the error of a failed create', async () => {
    const fake = await newEngine();
    const runtime = runtimeOn(fake);
    await runtime.provision(spec('alpha'));
    await runtime.describe();
    fake.failNext(
      /POST \/containers\/create name=pah-abcdef01-alpha/u,
      400,
      `bad env PERSONAL_AGENT_MODEL_API_KEY=${KEY}`,
    );
    const error = (await runtime
      .start(spec('alpha'), { modelApiKey: KEY })
      .catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain(KEY);
  });
});

describe('rollback', () => {
  it('leaves nothing when the volume cannot be created', async () => {
    const fake = await newEngine();
    const runtime = runtimeOn(fake);
    fake.failNext(/POST \/volumes\/create/u, 500, 'disk full');
    await expect(runtime.provision(spec('alpha'))).rejects.toMatchObject({ code: 'failed' });
    expect(fake.hasObjects()).toBe(false);
  });

  it('removes the volume it made when the network cannot be created', async () => {
    const fake = await newEngine();
    const runtime = runtimeOn(fake);
    fake.failNext(/POST \/networks\/create/u, 500, 'no bridge');
    await expect(runtime.provision(spec('alpha'))).rejects.toThrow(/no bridge/u);
    expect(fake.hasObjects()).toBe(false);
  });

  it('keeps a volume that existed before when a later step fails', async () => {
    const fake = await newEngine();
    const runtime = runtimeOn(fake);
    await runtime.provision(spec('alpha'));
    await runtime.destroy('alpha');
    await runtime.provision(spec('alpha'));
    // Re-provisioning is idempotent and removes nothing it did not create.
    fake.failNext(/GET \/networks\/pah-/u, 500, 'engine hiccup');
    await expect(runtime.provision(spec('alpha'))).rejects.toThrow();
    expect(fake.volumeNames()).toEqual([`${NAME}-state`]);
    expect(fake.networkNames()).toEqual([NAME]);
  });

  it('refuses a subnet that overlaps a network the engine already has', async () => {
    const fake = await newEngine();
    const runtime = runtimeOn(fake);
    await new EngineClient({ endpoint: fake.endpoint }).json('POST', '/networks/create', {
      body: { Name: 'other', IPAM: { Config: [{ Subnet: '10.200.0.0/24' }] } },
    });
    const error = (await runtime.provision(spec('alpha')).catch((e: unknown) => e)) as Error;
    expect(error.message).toMatch(/overlaps the engine network other/u);
    expect(fake.volumeNames()).toEqual([]);
  });

  describe('host routes', () => {
    it('refuses a subnet that overlaps a route of the engine host, creating nothing', async () => {
      const fake = await newEngine();
      fake.hostRoutes = [{ iface: 'eth1', cidr: '10.200.0.0/16' }];
      const runtime = runtimeOn(fake);
      const error = (await runtime
        .provision(spec('alpha'))
        .catch((e: unknown) => e)) as RuntimePortError;
      expect(error.code).toBe('failed');
      expect(error.message).toMatch(
        /overlaps a route of the engine host \(10\.200\.0\.0\/16 on eth1\)/u,
      );
      expect(fake.hasObjects()).toBe(false);
    });

    it('refuses a narrower route inside the subnet as well', async () => {
      const fake = await newEngine();
      fake.hostRoutes = [{ iface: 'tun0', cidr: '10.200.0.4/32' }];
      await expect(runtimeOn(fake).provision(spec('alpha'))).rejects.toThrow(
        /10\.200\.0\.4\/32 on tun0/u,
      );
      expect(fake.hasObjects()).toBe(false);
    });

    it('accepts a subnet no route touches, whatever else the host routes', async () => {
      const fake = await newEngine();
      fake.hostRoutes = [
        { iface: 'eth0', cidr: '192.168.1.0/24' },
        { iface: 'docker0', cidr: '172.17.0.0/16' },
      ];
      await expect(runtimeOn(fake).provision(spec('alpha'))).resolves.toMatchObject({
        account: 'alpha',
      });
    });

    it('ignores the routes of its own bridges', async () => {
      const fake = await newEngine();
      const runtime = runtimeOn(fake);
      await runtime.provision(spec('alpha'));
      // The bridge of alpha now carries a route for its own subnet; beta must still be provisioned.
      fake.hostRoutes = [{ iface: 'pahabcdef000', cidr: '10.200.0.0/29' }];
      await expect(runtime.provision(spec('beta'))).resolves.toMatchObject({ account: 'beta' });
    });

    it('refuses when the routes cannot be read, creating nothing', async () => {
      const fake = await newEngine();
      fake.routesFailure = 1;
      await expect(runtimeOn(fake).provision(spec('alpha'))).rejects.toThrow(
        /routes of the engine host/u,
      );
      expect(fake.hasObjects()).toBe(false);
    });

    it('does not ask again for an account whose network already exists', async () => {
      const fake = await newEngine();
      const runtime = runtimeOn(fake);
      await runtime.provision(spec('alpha'));
      fake.routesFailure = 1;
      await expect(runtime.provision(spec('alpha'))).resolves.toMatchObject({ account: 'alpha' });
    });
  });

  it('carries on the engine refusal of an overlap it detects itself', async () => {
    const fake = await newEngine();
    const runtime = runtimeOn(fake);
    fake.failNext(
      /POST \/networks\/create/u,
      403,
      'Pool overlaps with other one on this address space',
    );
    await expect(runtime.provision(spec('alpha'))).rejects.toThrow(/Pool overlaps/u);
    expect(fake.hasObjects()).toBe(false);
  });

  it('refuses a network of the account that is on another subnet', async () => {
    const fake = await newEngine();
    const runtime = runtimeOn(fake);
    await runtime.provision(spec('alpha'));
    await expect(runtime.provision(spec('alpha', { subnetSlot: 9 }))).rejects.toThrow(
      /expected 10\.200\.0\.72\/29/u,
    );
  });

  it('removes the container when the start call fails', async () => {
    const fake = await newEngine();
    const runtime = runtimeOn(fake);
    await runtime.provision(spec('alpha'));
    fake.failNext(/POST \/containers\/pah-abcdef01-alpha\/start/u, 500, 'oci runtime error');
    await expect(runtime.start(spec('alpha'), {})).rejects.toThrow(/oci runtime error/u);
    expect(fake.containerNames()).toEqual([]);
    expect((await runtime.inspect('alpha')).state).toBe('stopped');
  });

  it('removes the container when the create call fails after a stale one was cleared', async () => {
    const fake = await newEngine();
    const runtime = runtimeOn(fake);
    await runtime.provision(spec('alpha'));
    fake.failNext(
      /POST \/containers\/create name=pah-abcdef01-alpha/u,
      404,
      'No such image: personal-agent:test',
    );
    await expect(runtime.start(spec('alpha'), {})).rejects.toThrow(/No such image/u);
    expect(fake.containerNames()).toEqual([]);
  });

  it('removes a unit that never becomes healthy', async () => {
    const fake = await newEngine();
    fake.healthyAfterPolls = Number.POSITIVE_INFINITY;
    const runtime = runtimeOn(fake, { readyTimeoutMs: 60 });
    await runtime.provision(spec('alpha'));
    await expect(runtime.start(spec('alpha'), {})).rejects.toThrow(/did not become healthy/u);
    expect(fake.containerNames()).toEqual([]);
  });

  it('removes a unit that exits while starting and says how', async () => {
    const fake = await newEngine();
    fake.startExit = 3;
    const runtime = runtimeOn(fake);
    await runtime.provision(spec('alpha'));
    await expect(runtime.start(spec('alpha'), {})).rejects.toThrow(/exit code 3/u);
    expect(fake.containerNames()).toEqual([]);
  });

  it('does not report a destroy that left something behind as done', async () => {
    const { fake, runtime } = await started();
    fake.failNext(/DELETE \/volumes\//u, 500, 'volume busy');
    await expect(runtime.destroy('alpha')).rejects.toThrow(/volume busy|left volume/u);
    fake.failNext(/DELETE \/containers\//u, 500, 'cannot kill');
    await expect(runtime.destroy('alpha')).rejects.toThrow(/cannot kill/u);
  });

  it('verifies the engine holds nothing of the unit after destroy', async () => {
    const { fake, runtime } = await started();
    await runtime.destroy('alpha');
    expect(fake.hasObjects()).toBe(false);
    // It looked by label, not by the names it expected.
    for (const path of ['/containers/json', '/volumes', '/networks']) {
      expect(
        fake.requests.some((r) => r.method === 'GET' && r.path === path && r.body === undefined),
      ).toBe(true);
    }
  });
});

describe('lifecycle', () => {
  it('stops a unit and keeps its volume and network', async () => {
    const { fake, runtime } = await started();
    await runtime.stop('alpha');
    expect(fake.containerNames()).toEqual([]);
    expect(fake.volumeNames()).toHaveLength(1);
    expect(fake.networkNames()).toHaveLength(1);
  });

  it('starts a stopped unit again with the same address and access code', async () => {
    const { runtime } = await started();
    const code = (await runtime.accessCode('alpha')).code;
    await runtime.stop('alpha');
    expect((await runtime.accessCode('alpha')).code).toBe(code);
    const again = await runtime.start(spec('alpha'), { modelApiKey: KEY });
    expect(again.endpoints.host).toBe('10.200.0.2');
    expect((await runtime.accessCode('alpha')).code).toBe(code);
  });

  it('leaves a unit that is already running as it is', async () => {
    const { fake, runtime } = await started();
    await runtime.start(spec('alpha'), { modelApiKey: KEY });
    expect(
      fake.requests.filter(
        (r) =>
          r.path === '/containers/create' &&
          r.body?.Labels?.['robota.personal-agent-host.kind'] === 'unit',
      ),
    ).toHaveLength(1);
  });

  it('replaces a unit that exited on its own', async () => {
    const { fake, runtime } = await started();
    fake.crash(NAME, 137);
    expect(await runtime.inspect('alpha')).toMatchObject({ state: 'exited', healthy: false });
    await runtime.start(spec('alpha'), { modelApiKey: KEY });
    expect(await runtime.inspect('alpha')).toMatchObject({ state: 'running', healthy: true });
    expect(fake.containerNames()).toEqual([NAME]);
  });

  it('reads the access code from the volume with a throwaway container that has no network and no write access', async () => {
    const { fake, runtime } = await started();
    await runtime.accessCode('alpha');
    const helper = fake.requests
      .filter(
        (r) =>
          r.path === '/containers/create' &&
          r.body?.Labels?.['robota.personal-agent-host.kind'] === 'helper',
      )
      .at(-1)?.body;
    expect(helper?.Entrypoint).toEqual(['cat', '/state/server-access-code']);
    expect(helper?.HostConfig).toMatchObject({
      NetworkMode: 'none',
      CapDrop: ['ALL'],
      ReadonlyRootfs: true,
      Mounts: [{ Type: 'volume', Source: `${NAME}-state`, Target: '/state', ReadOnly: true }],
    });
    expect(helper?.Image).toBe('personal-agent:test');
    expect(fake.containerNames()).toEqual([NAME]); // the helper is gone
  });

  it('lists every unit of this install, recorded or not, and no one else’s', async () => {
    const fake = await newEngine();
    const runtime = runtimeOn(fake);
    await runtime.provision(spec('alpha'));
    await runtime.provision(spec('beta'));
    // A stray volume with this install's labels and nothing else.
    const client = new EngineClient({ endpoint: fake.endpoint });
    await client.json('POST', '/volumes/create', {
      body: {
        Name: `pah-${INSTALL}-stray-state`,
        Labels: {
          'robota.personal-agent-host.install': INSTALL,
          'robota.personal-agent-host.account': 'stray',
          'robota.personal-agent-host.slot': '7',
        },
      },
    });
    // Another install's unit on the same engine.
    await runtimeOn(fake, { installId: '12345678' }).provision(
      spec('alpha', { installId: '12345678', subnetSlot: 20 }),
    );
    expect((await runtime.list()).map((u) => u.account)).toEqual(['alpha', 'beta', 'stray']);
  });

  it('still lists a unit whose slot lies outside the current pool, so it can be stopped', async () => {
    const { fake, runtime } = await started();
    const client = new EngineClient({ endpoint: fake.endpoint });
    await client.json('POST', '/volumes/create', {
      body: {
        Name: `pah-${INSTALL}-old-state`,
        Labels: {
          'robota.personal-agent-host.install': INSTALL,
          'robota.personal-agent-host.account': 'old',
          'robota.personal-agent-host.slot': '99999',
        },
      },
    });
    const listed = await runtime.list();
    expect(listed.map((u) => u.account)).toEqual(['alpha', 'old']);
    expect(listed[0]).toMatchObject({ state: 'running' });
    expect(listed[1]).toMatchObject({ state: 'stopped', endpoints: { host: '' } });
    await expect(runtime.inspect('old')).rejects.toMatchObject({ code: 'failed' });
  });

  it('stops a running unit whose slot lies outside the current pool', async () => {
    const fake = await newEngine();
    const wide = runtimeOn(fake);
    await wide.provision(spec('alpha', { subnetSlot: 100 }));
    await wide.start(spec('alpha', { subnetSlot: 100 }), { modelApiKey: KEY });
    const narrowPool = parseSubnetPool('10.200.0.0/24');
    if (typeof narrowPool === 'string') throw new Error(narrowPool);
    const narrow = runtimeOn(fake, { subnetPool: narrowPool });
    const listed = await narrow.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      account: 'alpha',
      state: 'running',
      endpoints: { host: '' },
    });
    await narrow.stop('alpha');
    expect((await narrow.list())[0]).toMatchObject({ state: 'stopped' });
    await expect(narrow.stop('nobody')).rejects.toMatchObject({ code: 'unknown-account' });
  });

  it('refuses a unit of another install or one outside the pool', async () => {
    const fake = await newEngine();
    const runtime = runtimeOn(fake);
    await expect(runtime.provision(spec('alpha', { installId: '12345678' }))).rejects.toMatchObject(
      {
        code: 'invalid-spec',
      },
    );
    await expect(runtime.provision(spec('alpha', { subnetSlot: 99_999 }))).rejects.toMatchObject({
      code: 'invalid-spec',
    });
    expect(fake.hasObjects()).toBe(false);
  });

  it('turns an engine that cannot be reached into a typed failure', async () => {
    const runtime = new ContainerRuntime({
      engine: new EngineClient({ endpoint: 'unix:///tmp/pah-no-such-engine.sock' }),
      installId: INSTALL,
      subnetPool: POOL as Exclude<typeof POOL, string>,
      guardImage: 'guard:test',
    });
    await expect(runtime.list()).rejects.toMatchObject({ code: 'failed' });
    expect((await runtime.describe()).guard.state).toBe('unverified');
  });
});

describe('the guard as the backend uses it', () => {
  it('applies the guard before the first start and checks it before every later one', async () => {
    const { fake, runtime } = await started();
    const helpers = (first: string): number =>
      fake.requests.filter(
        (r) =>
          r.path === '/containers/create' &&
          (r.body?.Entrypoint as string[] | undefined)?.[0] === first,
      ).length;
    expect(helpers('sh')).toBe(1);
    const listed = helpers('nft');
    await runtime.stop('alpha');
    await runtime.start(spec('alpha'), {});
    expect(helpers('sh')).toBe(1); // still intact, so not reapplied
    expect(helpers('nft')).toBe(listed + 1); // but read back before this start
  });

  it('runs the firewall helper on the host network with the one capability it needs', async () => {
    const { fake } = await started();
    const apply = fake.requests.find(
      (r) =>
        r.path === '/containers/create' &&
        (r.body?.Entrypoint as string[] | undefined)?.join(' ').includes('nft -f'),
    )?.body;
    expect(apply?.Image).toBe('guard:test');
    expect(apply?.HostConfig).toMatchObject({
      NetworkMode: 'host',
      Privileged: false,
      CapDrop: ['ALL'],
      CapAdd: ['NET_ADMIN'],
      ReadonlyRootfs: true,
      SecurityOpt: ['no-new-privileges:true'],
    });
    expect(apply?.Entrypoint?.join(' ')).toContain('inet pah_abcdef01');
    expect(fake.guardRules).toContain('table inet pah_abcdef01 {');
  });

  it('allows DNS only to the resolvers it finds, without the loopback ones', async () => {
    const { fake } = await started();
    expect(fake.guardRules).toContain('ip daddr { 192.0.2.53 } accept');
    expect(fake.guardRules).not.toContain('127.0.0.11');
  });

  it('uses the resolvers it is told when it is told', async () => {
    const fake = await newEngine();
    const runtime = runtimeOn(fake, { resolvers: ['10.9.9.9'] });
    await runtime.provision(spec('alpha'));
    await runtime.start(spec('alpha'), {});
    expect(fake.guardRules).toContain('{ 10.9.9.9 }');
    expect(
      fake.requests.some(
        (r) => (r.body?.Entrypoint as string[] | undefined)?.join(' ') === 'cat /etc/resolv.conf',
      ),
    ).toBe(false);
  });

  it('reads nameservers from a resolver file', () => {
    expect(
      parseResolvers(
        '# c\nsearch x\nnameserver 8.8.8.8\nnameserver 127.0.0.53\nnameserver ::1\nnameserver 10.0.0.2\n',
      ),
    ).toEqual(['8.8.8.8', '10.0.0.2']);
  });

  it('reapplies a guard another firewall manager flushed, and tells when it cannot', async () => {
    const { fake, runtime } = await started();
    fake.flushGuard();
    expect((await runtime.describe()).guard.state).toBe('verified');
    expect(fake.guardRules).toBeDefined();
    fake.tamperGuard();
    expect((await runtime.describe()).guard.state).toBe('verified');
    expect(fake.guardRules).not.toContain('# edited');

    fake.flushGuard();
    fake.guardApplyFailure = { code: 1, output: 'Error: Operation not supported' };
    const description = await runtime.describe();
    expect(description.guard.state).toBe('unverified');
    expect(description.guard.detail).toMatch(/cannot apply the guard: .*Operation not supported/u);
  });

  it('refuses to start while the guard cannot be applied, and starts nothing', async () => {
    const fake = await newEngine();
    fake.guardApplyFailure = { code: 1, output: 'Error: Could not process rule' };
    const runtime = runtimeOn(fake);
    await runtime.provision(spec('alpha'));
    await expect(runtime.start(spec('alpha'), { modelApiKey: KEY })).rejects.toMatchObject({
      code: 'guard-unverified',
    });
    expect(fake.containerNames()).toEqual([]);
    expect(JSON.stringify(fake.requests)).not.toContain(KEY);
  });

  it('treats a guard it did not apply itself as unverified until it has applied it', async () => {
    const fake = await newEngine();
    fake.guardRules = '# left by an earlier process';
    const runtime = runtimeOn(fake);
    expect((await runtime.describe()).guard.state).toBe('verified');
    expect(fake.guardRules).toContain('table inet pah_abcdef01 {');
  });

  it('applies one guard at a time when asked at once', async () => {
    const fake = await newEngine();
    const runtime = runtimeOn(fake);
    await Promise.all([runtime.describe(), runtime.describe(), runtime.describe()]);
    const applies = fake.requests.filter(
      (r) =>
        r.path === '/containers/create' &&
        (r.body?.Entrypoint as string[] | undefined)?.join(' ').includes('nft -f'),
    );
    expect(applies).toHaveLength(1);
  });

  it('describes the isolation it gives, including that it is for trusted accounts', async () => {
    const description = await runtimeOn(await newEngine()).describe();
    expect(description.backend).toBe('container');
    expect(description.isolation.join(' ')).toMatch(/trusted accounts only/u);
  });
});
