import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  API_CEILING,
  API_FLOOR,
  EngineClient,
  EngineError,
  isNotFound,
  negotiateVersion,
} from '../runtime/container/engine-client.js';
import { FakeEngine } from './fake-engine.js';
import { cleanTempDirs, tempDir } from './harness.js';

const engines: FakeEngine[] = [];

async function engine(): Promise<FakeEngine> {
  const fake = new FakeEngine();
  await fake.listen();
  engines.push(fake);
  return fake;
}

afterEach(async () => {
  await Promise.all(engines.splice(0).map((e) => e.close()));
  await cleanTempDirs();
});

describe('API version negotiation', () => {
  it('speaks the newest version both know, capped at the ceiling', () => {
    expect(negotiateVersion('1.56', '1.24')).toBe(API_CEILING);
    expect(negotiateVersion('1.43', '1.24')).toBe('1.43');
    expect(negotiateVersion(API_FLOOR, '1.12')).toBe(API_FLOOR);
  });

  it('refuses an engine older than the floor', () => {
    expect(() => negotiateVersion('1.40', '1.12')).toThrow(/at least 1\.41/u);
  });

  it('refuses an engine that has dropped the version this host speaks', () => {
    expect(() => negotiateVersion('1.99', '1.99')).toThrow(/needs API 1\.99/u);
  });

  it('refuses an unreadable version', () => {
    expect(() => negotiateVersion('latest', '1.24')).toThrow(EngineError);
  });
});

describe('engine client', () => {
  it('negotiates once and prefixes every call with the version', async () => {
    const fake = await engine();
    const client = new EngineClient({ endpoint: fake.endpoint });
    await client.json('GET', '/volumes');
    await client.json('GET', '/networks');
    expect(fake.requests.map((r) => r.path)).toEqual(['/version', '/volumes', '/networks']);
    expect(await client.apiVersion()).toBe(API_CEILING);
  });

  it('follows an older engine down and refuses one below the floor', async () => {
    const old = await engine();
    old.apiVersion = '1.43';
    expect(await new EngineClient({ endpoint: old.endpoint }).apiVersion()).toBe('1.43');
    const tooOld = await engine();
    tooOld.apiVersion = '1.40';
    await expect(
      new EngineClient({ endpoint: tooOld.endpoint }).json('GET', '/volumes'),
    ).rejects.toThrow(/at least 1\.41/u);
  });

  it('sends a JSON body and a query and reads JSON back', async () => {
    const fake = await engine();
    const client = new EngineClient({ endpoint: fake.endpoint });
    const volume = await client.json<{ Name: string }>('POST', '/volumes/create', {
      body: { Name: 'v', Labels: { a: 'b' } },
    });
    expect(volume.Name).toBe('v');
    const listed = await client.json<{ Volumes: Array<{ Name: string }> }>('GET', '/volumes', {
      query: { filters: JSON.stringify({ label: ['a=b'] }) },
    });
    expect(listed.Volumes.map((v) => v.Name)).toEqual(['v']);
  });

  it('turns an engine refusal into an error with its message and status, never the request body', async () => {
    const fake = await engine();
    fake.failNext(/POST \/volumes\/create/u, 409, 'volume name is taken');
    const client = new EngineClient({ endpoint: fake.endpoint });
    const error = await client
      .json('POST', '/volumes/create', { body: { Name: 'v', Labels: { token: 'sk-body-secret' } } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).status).toBe(409);
    expect((error as EngineError).message).toContain('volume name is taken');
    expect((error as EngineError).message).not.toContain('sk-body-secret');
  });

  it('tells a missing object apart from other failures', async () => {
    const fake = await engine();
    const client = new EngineClient({ endpoint: fake.endpoint });
    const missing = await client.json('GET', '/volumes/none').catch((e: unknown) => e);
    expect(isNotFound(missing)).toBe(true);
    fake.failNext(/GET \/volumes\/none/u, 500, 'boom');
    expect(isNotFound(await client.json('GET', '/volumes/none').catch((e: unknown) => e))).toBe(
      false,
    );
  });

  it('names an unreachable engine without a stack of causes', async () => {
    const client = new EngineClient({ endpoint: 'unix:///tmp/pah-no-such-engine.sock' });
    await expect(client.json('GET', '/volumes')).rejects.toThrow(
      /Cannot reach the engine at unix:\/\/\/tmp\/pah-no-such-engine\.sock/u,
    );
  });

  it('gives up on an engine that does not answer in time', async () => {
    const dir = await tempDir();
    const socket = `${dir}/silent.sock`;
    const silent = createServer((req) => {
      req.resume();
    });
    await new Promise<void>((resolve) => silent.listen(socket, resolve));
    try {
      const client = new EngineClient({ endpoint: `unix://${socket}`, timeoutMs: 50 });
      await expect(client.json('GET', '/volumes')).rejects.toThrow(
        /did not answer GET \/version in time/u,
      );
    } finally {
      silent.closeAllConnections();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });
});
