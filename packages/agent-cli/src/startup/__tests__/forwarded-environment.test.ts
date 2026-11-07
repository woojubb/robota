import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, expect, it } from 'vitest';

const fixture = fileURLToPath(new URL('../../testing/forwarded-environment-reader.ts', import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const children: ChildProcess[] = [];
const ID = '7bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
});

async function reader(timeoutMs = 5_000) {
  const child = spawn(process.execPath, ['--import', tsx, '--conditions=source', fixture, '--supervised-session-id', ID], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { PATH: process.env.PATH ?? '', FORWARDED_TEST_TIMEOUT_MS: String(timeoutMs) } });
  children.push(child);
  const [request] = await once(child, 'message');
  expect(request).toEqual({ kind: 'forwarded-environment-needed', id: ID });
  return child;
}

it('accepts a bounded string environment from its private admission channel', async () => {
  const child = await reader();
  const result = once(child, 'message');
  child.send({ kind: 'forwarded-environment', id: ID, environment: { APPROVED_KEY: 'synthetic' }, availableCredentialNames: ['UNSELECTED'] });
  expect((await result)[0]).toEqual({ result: 'accepted', environment: { APPROVED_KEY: 'synthetic' }, availableCredentialNames: ['UNSELECTED'] });
});

it.each([
  { kind: 'forwarded-environment', id: 'different', environment: {} },
  { kind: 'forwarded-environment', id: ID, environment: { 'BAD-NAME': 'x' } },
  { kind: 'forwarded-environment', id: ID, environment: { KEY: 7 } },
  { kind: 'forwarded-environment', id: ID, environment: { KEY: 'x'.repeat(129 * 1024) } },
  { kind: 'forwarded-environment', id: ID, environment: { PRODUCT_RUNTIME_POSTURE: 'local' } },
  { kind: 'forwarded-environment', id: ID, environment: { PRODUCT_HOSTED_RUNTIME_CONFIG: '/tmp/hosted.json' } },
  { kind: 'forwarded-environment', id: ID, environment: {}, availableCredentialNames: ['DUPLICATE', 'DUPLICATE'] },
  { kind: 'forwarded-environment', id: ID, environment: {}, availableCredentialNames: ['BAD-NAME'] },
  { kind: 'forwarded-environment', id: ID, environment: {}, availableCredentialNames: Array.from({ length: 257 }, (_, i) => `NAME_${i}`) },
  { kind: 'forwarded-environment', id: ID, environment: {}, availableCredentialNames: [3] },
])('rejects malformed admission without accepting it', async (message) => {
  const child = await reader();
  const result = once(child, 'message');
  child.send(message);
  expect((await result)[0]).toMatchObject({ result: 'refused', message: expect.stringMatching(/malformed/) });
});

it('refuses when its parent sends no admission in time', async () => {
  const child = await reader(500);
  expect((await once(child, 'message'))[0]).toMatchObject({ result: 'refused', message: expect.stringMatching(/timed out/) });
});

it('ends if its parent disconnects before admitting the environment', async () => {
  const child = await reader();
  const exited = once(child, 'exit');
  child.disconnect();
  expect((await exited)[0]).toBe(1);
});
