import { afterEach, describe, expect, it } from 'vitest';

import { encodeEntry, readTar, TAR_TRAILER } from '../archive/tar.js';
import { parseSubnetPool } from '../config.js';
import { ContainerRuntime } from '../runtime/container/backend.js';
import { EngineClient } from '../runtime/container/engine-client.js';
import type { IUnitSpec } from '../runtime/port.js';
import { TEST_IMAGE_ID, unitSpecFor } from '../runtime/testing/contract.js';
import { FakeEngine } from './fake-engine.js';
import { cleanTempDirs } from './harness.js';

const INSTALL = 'abcdef01';
const NAME = `pah-${INSTALL}-alpha`;
const VOLUME = `${NAME}-state`;
const POOL = parseSubnetPool('10.200.0.0/16');
if (typeof POOL === 'string') throw new Error(POOL);

const engines: FakeEngine[] = [];

afterEach(async () => {
  await Promise.all(engines.splice(0).map((e) => e.close()));
  await cleanTempDirs();
});

function spec(overrides: Partial<IUnitSpec> = {}): IUnitSpec {
  return unitSpecFor('alpha', { installId: INSTALL, subnetSlot: 0, ...overrides });
}

async function stoppedWithState(): Promise<{ fake: FakeEngine; runtime: ContainerRuntime }> {
  const fake = new FakeEngine();
  await fake.listen();
  fake.resolvConf = 'nameserver 192.0.2.53\n';
  engines.push(fake);
  const runtime = new ContainerRuntime({
    engine: new EngineClient({ endpoint: fake.endpoint, timeoutMs: 2_000 }),
    installId: INSTALL,
    subnetPool: POOL as Exclude<typeof POOL, string>,
    guardImage: 'guard:test',
    readyTimeoutMs: 500,
    pollMs: 5,
  });
  await runtime.provision(spec());
  await runtime.start(spec(), {});
  await runtime.stop('alpha');
  fake.volumeFiles(VOLUME)?.set('notes/today.txt', 'remember');
  fake.volumeLinks(VOLUME)?.set('latest', 'notes/today.txt');
  return { fake, runtime };
}

async function collect(archive: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of archive) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts);
}

function entry(path: string, kind: 'file' | 'dir', data = ''): Buffer {
  return encodeEntry(
    { path, kind, flag: '', mode: 0o600, uid: 0, gid: 0, size: 0, mtime: 5, linkname: '' },
    Buffer.from(data),
  );
}

describe('state archives through the engine', () => {
  it('reads through a created helper that never runs, with no network and the volume read-only', async () => {
    const { fake, runtime } = await stoppedWithState();
    fake.requests.length = 0;
    await collect(await runtime.exportState(spec()));
    const created = fake.requests.find((r) => r.path === '/containers/create');
    expect(created?.body?.Image).toBe(TEST_IMAGE_ID);
    expect(created?.body?.Entrypoint).toEqual(['true']);
    const host = created?.body?.HostConfig as Record<string, unknown>;
    expect(host.NetworkMode).toBe('none');
    expect(host.CapDrop).toEqual(['ALL']);
    expect(host.Privileged).toBe(false);
    expect(host.Mounts).toEqual([
      { Type: 'volume', Source: VOLUME, Target: '/home/node/.personal', ReadOnly: true },
    ]);
    expect(fake.requests.some((r) => /\/start$/u.test(r.path))).toBe(false);
    expect(fake.archivePaths).toEqual(['/home/node/.personal/.']);
    expect(fake.containerNames()).toEqual([]);
  });

  it('reports entries without the engine wrapper, links included and no root entry', async () => {
    const { runtime } = await stoppedWithState();
    const seen: string[] = [];
    for await (const item of readTar(await runtime.exportState(spec()))) {
      const { header } = item;
      seen.push(
        `${header.kind}:${header.path}${header.linkname === '' ? '' : `>${header.linkname}`}`,
      );
    }
    expect(seen).toEqual([
      'symlink:latest>notes/today.txt',
      'dir:notes/',
      'file:notes/today.txt',
      'file:server-access-code',
    ]);
  });

  it('removes the helper when the engine fails to produce the archive', async () => {
    const { fake, runtime } = await stoppedWithState();
    fake.failNext(/^GET \/containers\/[^/]+\/archive/u, 500, 'disk on fire');
    await expect(collect(await runtime.exportState(spec()))).rejects.toMatchObject({
      code: 'failed',
    });
    expect(fake.containerNames()).toEqual([]);
  });

  it('replaces the volume instead of merging, as the unit user, with an owner-only root', async () => {
    const { fake, runtime } = await stoppedWithState();
    fake.requests.length = 0;
    await runtime.importState(
      spec(),
      (async function* () {
        yield entry('fresh/', 'dir');
        yield entry('fresh/new.txt', 'file', 'hello');
        yield TAR_TRAILER;
      })(),
    );
    const calls = fake.requests.map((r) => `${r.method} ${r.path}`);
    const dropped = calls.indexOf(`DELETE /volumes/${VOLUME}`);
    const created = calls.indexOf('POST /volumes/create');
    const put = calls.findIndex((c) => /^PUT \/containers\/[^/]+\/archive$/u.test(c));
    expect(dropped).toBeGreaterThanOrEqual(0);
    expect(created).toBeGreaterThan(dropped);
    expect(put).toBeGreaterThan(created);
    expect(Object.fromEntries(fake.volumeFiles(VOLUME) ?? [])).toEqual({
      'fresh/new.txt': 'hello',
    });
    expect(fake.volumeLinks(VOLUME)?.size).toBe(0);
    expect(fake.volume(VOLUME)).toMatchObject({ 'robota.personal-agent-host.account': 'alpha' });
    expect(fake.archivePaths).toEqual(['/home/node/.personal']);
    const [root, ...rest] = fake.lastPut;
    expect(root).toMatchObject({ path: './', kind: 'dir', mode: 0o700, uid: 1000, gid: 1000 });
    expect(rest.map((h) => [h.uid, h.gid])).toEqual([
      [1000, 1000],
      [1000, 1000],
    ]);
    const helper = fake.requests.find((r) => r.path === '/containers/create');
    expect((helper?.body?.HostConfig as Record<string, unknown>).Mounts).toEqual([
      { Type: 'volume', Source: VOLUME, Target: '/home/node/.personal', ReadOnly: false },
    ]);
    expect(fake.containerNames()).toEqual([]);
    // The unit then starts and runs on the restored state.
    await runtime.start(spec(), {});
    expect((await runtime.inspect('alpha')).healthy).toBe(true);
  });

  it('removes an exited unit container first, and the helper after a failed upload', async () => {
    const { fake, runtime } = await stoppedWithState();
    await runtime.start(spec(), {});
    fake.crash(NAME);
    fake.failNext(/^PUT \/containers\/[^/]+\/archive/u, 500, 'no space left');
    await expect(
      runtime.importState(
        spec(),
        (async function* () {
          yield entry('a.txt', 'file', 'x');
          yield TAR_TRAILER;
        })(),
      ),
    ).rejects.toMatchObject({ code: 'failed' });
    expect(fake.containerNames()).toEqual([]);
  });

  it('refuses a running unit and a spec of another install', async () => {
    const { runtime } = await stoppedWithState();
    await runtime.start(spec(), {});
    await expect(runtime.exportState(spec())).rejects.toMatchObject({ code: 'failed' });
    await expect(runtime.exportState(spec({ installId: 'ffffffff' }))).rejects.toMatchObject({
      code: 'invalid-spec',
    });
  });
});
