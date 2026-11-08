import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { completeSpawnerPair } from '@robota-sdk/agent-transport/link';
import { expect, it } from 'vitest';

import { createTestBinaryEnvironment } from '../../__tests__/helpers/product-runtime.js';

it('cannot erase an initially hosted posture through forwarded IPC', async () => {
  const home = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'hosted-fd-')));
  const id = '7bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
  const fixture = fileURLToPath(new URL('../../testing/secure-runtime-entry.ts', import.meta.url));
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const child = spawn(process.execPath, ['--import', tsx, '--conditions=product-source', fixture, '--serve', '--supervised-session-id', id, '--supervised-spawner-pair', '--supervised-forwarded-environment', '--restricted-workspace'], {
    cwd: home, env: createTestBinaryEnvironment(home, { PRODUCT_RUNTIME_POSTURE: 'hosted', PRODUCT_TELEMETRY_ENABLED: '0' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'],
  });
  let stderr = '';
  let requested = false;
  child.stderr?.on('data', (part: Buffer) => { stderr += part.toString(); });
  child.on('message', (message: unknown) => {
    if (typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'forwarded-environment-needed') {
      requested = true;
      child.send({ kind: 'forwarded-environment', id, environment: { PRODUCT_RUNTIME_POSTURE: 'local' } });
    } else if (typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'ready') child.kill();
  });
  try {
    const pipe = child.stdio[4];
    if (!(pipe instanceof Duplex)) throw new Error('Missing spawner pipe');
    const pair = await completeSpawnerPair(pipe);
    pair.spawnerKey.wipe();
    const [code] = await once(child, 'exit');
    expect(code).not.toBe(0);
    expect(requested).toBe(false);
    expect(stderr).toMatch(/hosted runtime admission refused/i);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

it.each([
  { UNAPPROVED_SYNTHETIC: 'unapproved' },
  { PATH: '/attacker/bin' },
  { NODE_OPTIONS: '--require=/tmp/unapproved.js' },
  { PRODUCT_TELEMETRY_UNAPPROVED: 'unapproved' },
  { PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_TRACES: 'otlp', PRODUCT_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf', PRODUCT_TELEMETRY_OTLP_ENDPOINT: 'https://example.com' },
])('rejects an IPC environment not admitted by the runtime', async (environment) => {
  const home = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'unapproved-fd-')));
  const id = '7bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
  const fixture = fileURLToPath(new URL('../../testing/secure-runtime-entry.ts', import.meta.url));
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const child = spawn(process.execPath, ['--import', tsx, '--conditions=product-source', fixture, '--serve', '--supervised-session-id', id, '--supervised-spawner-pair', '--supervised-forwarded-environment', '--restricted-workspace'], {
    cwd: home, env: createTestBinaryEnvironment(home, { PRODUCT_TELEMETRY_ENABLED: '0' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'],
  });
  let stderr = '';
  let ready = false;
  child.stderr?.on('data', (part: Buffer) => { stderr += part.toString(); });
  child.on('message', (message: unknown) => {
    if (typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'forwarded-environment-needed') {
      child.send({ kind: 'forwarded-environment', id, environment });
    } else if (typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'ready') { ready = true; child.kill(); }
  });
  try {
    const pipe = child.stdio[4];
    if (!(pipe instanceof Duplex)) throw new Error('Missing spawner pipe');
    const pair = await completeSpawnerPair(pipe);
    pair.spawnerKey.wipe();
    await once(child, 'exit');
    expect(ready).toBe(false);
    expect(stderr).toMatch(/forwarded.*not admitted/i);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);
