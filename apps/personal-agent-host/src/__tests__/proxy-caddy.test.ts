import { chmod, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CaddyProxy, unixSocketTransport } from '../proxy/caddy.js';
import { configHash, generateCaddyfile, type ICaddyfileSettings } from '../proxy/caddyfile.js';
import type { ProxySite } from '../proxy/port.js';
import { hostEnv } from './admin-harness.js';
import { FakeAdminSocket } from './fake-admin.js';
import { FakeEngine } from './fake-engine.js';
import { addInput, cleanTempDirs, tempDir } from './harness.js';
import { type IRunningHost, startServe } from '../serve.js';

const SETTINGS: ICaddyfileSettings = {
  tls: { mode: 'internal' },
  adminListen: '/run/caddy/admin.sock',
};
const alice: ProxySite = {
  kind: 'active',
  hostname: 'alice.agents.example.test',
  guiUpstream: '10.200.0.2:7360',
  wsUpstream: '10.200.0.2:7361',
};
const bob: ProxySite = { kind: 'suspended', hostname: 'bob.agents.example.test' };

const admins: FakeAdminSocket[] = [];
const hosts: IRunningHost[] = [];
const engines: FakeEngine[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.stop()));
  await Promise.all(admins.splice(0).map((a) => a.close()));
  await Promise.all(engines.splice(0).map((e) => e.close()));
  await cleanTempDirs();
});

async function setup(): Promise<{ admin: FakeAdminSocket; proxy: CaddyProxy; configPath: string }> {
  const admin = new FakeAdminSocket();
  await admin.listen();
  admins.push(admin);
  const configPath = join(await tempDir(), 'Caddyfile');
  const proxy = new CaddyProxy({
    configPath,
    settings: SETTINGS,
    transport: unixSocketTransport(admin.socketPath, 2_000),
  });
  return { admin, proxy, configPath };
}

describe('applying a configuration', () => {
  it('writes the file owner-only and loads the same text through the admin socket', async () => {
    const { admin, proxy, configPath } = await setup();
    const { hash } = await proxy.apply([alice, bob]);
    const text = generateCaddyfile([alice, bob], SETTINGS);
    expect(await readFile(configPath, 'utf8')).toBe(text);
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect(admin.calls).toEqual([
      { method: 'POST', path: '/load', contentType: 'text/caddyfile', body: text },
    ]);
    expect(hash).toBe(configHash(text));
    expect(hash).toMatch(/^[0-9a-f]{16}$/u);
  });

  it('leaves no temporary file behind and never exposes a partial file', async () => {
    const { proxy, configPath } = await setup();
    await proxy.apply([alice]);
    await proxy.apply([alice, bob]);
    expect(await readdir(join(configPath, '..'))).toEqual(['Caddyfile']);
  });

  it('gives a different hash when the sites differ and the same one when they do not', async () => {
    const { proxy } = await setup();
    const first = await proxy.apply([alice]);
    expect((await proxy.apply([alice])).hash).toBe(first.hash);
    expect((await proxy.apply([alice, bob])).hash).not.toBe(first.hash);
  });

  it('loads again when nothing changed, so a restarted proxy gets its sites back', async () => {
    const { admin, proxy } = await setup();
    await proxy.apply([alice]);
    await proxy.apply([alice]);
    expect(admin.calls).toHaveLength(2);
  });

  it('serialises concurrent applies in the order they were asked', async () => {
    const { admin, proxy } = await setup();
    await Promise.all([proxy.apply([alice]), proxy.apply([alice, bob]), proxy.apply([])]);
    expect(admin.calls.map((c) => c.body)).toEqual([
      generateCaddyfile([alice], SETTINGS),
      generateCaddyfile([alice, bob], SETTINGS),
      generateCaddyfile([], SETTINGS),
    ]);
  });
});

describe('a configuration the proxy refuses', () => {
  it('restores the last good file, reloads it, and reports the proxy’s reason', async () => {
    const { admin, proxy, configPath } = await setup();
    const good = await proxy.apply([alice]);
    const goodText = await readFile(configPath, 'utf8');
    admin.failNext(400, 'adapting config: unrecognized directive: bogus');
    await expect(proxy.apply([alice, bob])).rejects.toMatchObject({
      code: 'runtime-failed',
      message: expect.stringContaining('unrecognized directive: bogus'),
    });
    expect(await readFile(configPath, 'utf8')).toBe(goodText);
    expect(admin.calls.at(-1)?.body).toBe(goodText);
    // The next apply starts from the good state and reports its own hash.
    expect((await proxy.apply([alice])).hash).toBe(good.hash);
  });

  it('writes no file for a configuration the proxy refused, even beside a good one', async () => {
    const { admin, proxy, configPath } = await setup();
    await proxy.apply([alice]);
    admin.failNext(400, 'bad');
    await expect(proxy.apply([alice, bob])).rejects.toBeDefined();
    expect(await readdir(join(configPath, '..'))).toEqual(['Caddyfile']);
    expect(await readFile(configPath, 'utf8')).toBe(generateCaddyfile([alice], SETTINGS));
  });

  it('puts the proxy back on the last good configuration when the file cannot be written', async () => {
    const { admin, proxy, configPath } = await setup();
    await proxy.apply([alice]);
    const dir = join(configPath, '..');
    await chmod(dir, 0o500);
    try {
      await expect(proxy.apply([alice, bob])).rejects.toMatchObject({ code: 'runtime-failed' });
    } finally {
      await chmod(dir, 0o700);
    }
    expect(admin.calls.at(-1)?.body).toBe(generateCaddyfile([alice], SETTINGS));
    expect(await readFile(configPath, 'utf8')).toBe(generateCaddyfile([alice], SETTINGS));
  });

  it('never writes a first file the proxy did not accept', async () => {
    const { admin, proxy, configPath } = await setup();
    admin.failNext(500, 'boom');
    await expect(proxy.apply([alice])).rejects.toMatchObject({ code: 'runtime-failed' });
    await expect(stat(configPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('falls back to the file already on disk when this process has not loaded one yet', async () => {
    const { admin, proxy, configPath } = await setup();
    await proxy.apply([bob]);
    const fresh = new CaddyProxy({
      configPath,
      settings: SETTINGS,
      transport: unixSocketTransport(admin.socketPath, 2_000),
    });
    admin.failNext();
    await expect(fresh.apply([alice])).rejects.toMatchObject({ code: 'runtime-failed' });
    expect(await readFile(configPath, 'utf8')).toBe(generateCaddyfile([bob], SETTINGS));
  });

  it('reports an admin socket that cannot be reached and keeps the previous file', async () => {
    const { admin, proxy, configPath } = await setup();
    await proxy.apply([alice]);
    await admin.close();
    await expect(proxy.apply([alice, bob])).rejects.toMatchObject({ code: 'runtime-failed' });
    expect(await readFile(configPath, 'utf8')).toBe(generateCaddyfile([alice], SETTINGS));
  });

  it('refuses an unvalidated value before it touches the file or the proxy', async () => {
    const { admin, proxy, configPath } = await setup();
    await proxy.apply([alice]);
    const before = admin.calls.length;
    await expect(
      proxy.apply([{ ...alice, guiUpstream: '10.0.0.2:7360\nrespond "x"' }]),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(admin.calls).toHaveLength(before);
    expect(await readFile(configPath, 'utf8')).toBe(generateCaddyfile([alice], SETTINGS));
  });

  it('keeps applying after a failure', async () => {
    const { admin, proxy } = await setup();
    admin.failNext();
    await expect(proxy.apply([alice])).rejects.toBeDefined();
    await expect(proxy.apply([alice])).resolves.toMatchObject({ hash: expect.any(String) });
  });
});

describe('behind the control plane', () => {
  it('serves what the control plane says, reports the hash in status, and follows suspend and delete', async () => {
    const admin = new FakeAdminSocket();
    await admin.listen();
    admins.push(admin);
    const engine = new FakeEngine();
    await engine.listen();
    engines.push(engine);
    const dir = await tempDir();
    const configPath = join(dir, 'Caddyfile');
    const host = await startServe(
      hostEnv(dir, {
        PERSONAL_AGENT_HOST_GUARD_IMAGE: 'guard:test',
        PERSONAL_AGENT_HOST_ENGINE_ENDPOINT: engine.endpoint,
        PERSONAL_AGENT_HOST_DNS_SERVERS: '10.0.0.2',
        PERSONAL_AGENT_HOST_PROXY_CONFIG: configPath,
        PERSONAL_AGENT_HOST_PROXY_ADMIN_SOCKET: admin.socketPath,
        PERSONAL_AGENT_HOST_PROXY_ADMIN_LISTEN: '/run/caddy/admin.sock',
      }),
      { log: () => undefined, reconcileMs: 3_600_000 },
    );
    hosts.push(host);
    // Starting reconciles once, so an empty proxy configuration is loaded before any account.
    expect(await readFile(configPath, 'utf8')).toBe(generateCaddyfile([], SETTINGS));

    await host.plane.add(addInput('alice'));
    const served = await readFile(configPath, 'utf8');
    expect(served).toContain('alice.agents.example.test {');
    expect(served).toMatch(/reverse_proxy 10\.200\.\d+\.\d+:7361 \{/u);
    expect(served).not.toContain('localhost');
    expect(served).not.toContain('127.0.0.1');
    expect((await host.plane.status()).routesHash).toBe(configHash(served));

    await host.plane.suspend('alice');
    const suspended = await readFile(configPath, 'utf8');
    expect(suspended).toContain('respond "This account is suspended." 503');
    expect(suspended).not.toContain('reverse_proxy');

    await host.plane.resume('alice');
    expect(await readFile(configPath, 'utf8')).toContain('reverse_proxy');

    await host.plane.delete('alice', 'alice');
    const deleted = await readFile(configPath, 'utf8');
    expect(deleted).not.toContain('alice.agents.example.test');
    expect(deleted).toBe(generateCaddyfile([], SETTINGS));
  });
});
