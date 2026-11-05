import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { serializeKeyring } from '@robota-sdk/agent-keyring';
import { fixtureKeyring } from '../../secure/__tests__/helpers.js';
import { Duplex } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { completeSpawnerPair } from '@robota-sdk/agent-transport-link';
import { afterEach, expect, it } from 'vitest';

import { createTestBinaryEnvironment, createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { hostedFixture } from '../../hosted/__tests__/hosted-fixture.js';
import { openRegisteredSpawnerLink } from '../owner-link-client.js';
import { listSupervisedSessions, resolveSupervisedDirectory, stopSupervisedSession } from '../supervised-session-control.js';

import type { ChildProcess } from 'node:child_process';

const fixture = fileURLToPath(new URL('../../testing/secure-runtime-entry.ts', import.meta.url));
const recorder = new URL('../../testing/forward-spawn-recorder.mjs', import.meta.url).href;
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const roots: string[] = [];
const children: ChildProcess[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

it('forwards the pair before workspace trust can spawn a child and leaves admission to the runtime', async () => {
  const root = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'forward-daemon-')));
  roots.push(root);
  expect(spawnSync('git', ['init', '-q', root]).status).toBe(0);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  if (process.platform !== 'win32') {
    const git = join(bin, 'git');
    writeFileSync(git, '#!/bin/sh\nif [ "${PRODUCT_SYNTHETIC_CREDENTIAL+x}" = x ]; then echo "$PPID present" >> "$HOME/git-env-audit"; else echo "$PPID absent" >> "$HOME/git-env-audit"; fi\nexec /usr/bin/git "$@"\n');
    chmodSync(git, 0o700);
  }
  const env = createTestBinaryEnvironment(root, { PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_TRACES: 'otlp', PRODUCT_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf', PRODUCT_SYNTHETIC_CREDENTIAL: 'owner-provider-key', PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` });
  let authorization: string | undefined;
  let telemetryRequests = 0;
  const server = createHttpServer((request, response) => {
    if (request.url === '/v1/traces') {
      telemetryRequests += 1;
      request.resume();
      response.writeHead(200).end();
      return;
    }
    authorization = request.headers.authorization;
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'FORWARD_ENV_REPLY' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Fixture did not listen');
  env.PRODUCT_TELEMETRY_OTLP_ENDPOINT = `http://127.0.0.1:${address.port}`;
  const runtime = createTestProductRuntime('test-product', env);
  mkdirSync(runtime.layout.userRoot, { recursive: true });
  const { keyring } = await fixtureKeyring();
  mkdirSync(dirname(runtime.layout.userPaths.keyring), { recursive: true, mode: 0o700 });
  writeFileSync(runtime.layout.userPaths.keyring, serializeKeyring(keyring), { mode: 0o600 });
  writeFileSync(runtime.layout.userPaths.settings, JSON.stringify({ currentProvider: 'openai', providers: { openai: { type: 'openai', model: 'fixture-model', apiKey: '$ENV:PRODUCT_SYNTHETIC_CREDENTIAL', baseURL: `http://127.0.0.1:${address.port}/v1`, options: { apiSurface: 'chat-completions' } } } }), { mode: 0o600 });
  const trusted = spawnSync(process.execPath, ['--import', tsx, '--conditions=source', fixture, 'trust', '--yes'], { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
  expect(trusted.status).toBe(0);
  telemetryRequests = 0;
  const child = spawn(process.execPath, ['--import', tsx, '--import', recorder, '--conditions=source', fixture, 'daemon', 'start', '--spawner-fd', '4', '--json'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'] });
  children.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (part: Buffer) => { stdout += part.toString(); });
  child.stderr?.on('data', (part: Buffer) => { stderr += part.toString(); });
  const pipe = child.stdio[4];
  if (!(pipe instanceof Duplex)) throw new Error('Missing desktop spawner pair');
  let pair: Awaited<ReturnType<typeof completeSpawnerPair>>;
  try { pair = await completeSpawnerPair(pipe); } catch (error) { throw new Error(`Pair failed: ${stderr}`, { cause: error }); }
  const [code] = await once(child, 'exit');
  expect(code, stderr).toBe(0);
  expect(stderr).toContain('TEST_FORWARD_FD_CLOSED');
  expect(stderr).toMatch(/telemetry.*not forwarded/i);
  expect(stderr).not.toContain('TEST_PRE_FORWARD_SPAWN');
  const reply = JSON.parse(stdout);
  expect(reply).toEqual({ id: expect.any(String) });
  const supervisedRoot = resolveSupervisedDirectory(runtime);
  const rows = await listSupervisedSessions(supervisedRoot, undefined, { includeGeneration: true });
  const row = rows.find((candidate) => candidate.id === reply.id);
  if (!row?.generation) throw new Error('Forwarded runtime is missing');
  const link = await openRegisteredSpawnerLink({ root: supervisedRoot, id: reply.id, generation: row.generation, ...pair });
  expect(link.standing).toBe('spawner');
  await link.control({ command: 'attach', fields: { mode: 'drive' } });
  const received: unknown[] = [];
  const complete = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Runtime did not complete: ${JSON.stringify(received)}; request: ${authorization}; stderr: ${stderr}`)), 15_000);
    link.session.onMessage((message) => {
      received.push(message);
      if (message.type === 'complete') { clearTimeout(timer); resolve(); }
      else if (message.type === 'error') { clearTimeout(timer); reject(new Error(`Runtime reported an error: ${JSON.stringify(message)}; request: ${authorization}; stderr: ${stderr}`)); }
    });
  });
  link.session.send({ type: 'submit', prompt: 'Hello from the desktop spawner' });
  await complete;
  expect(authorization).toBe('Bearer owner-provider-key');
  if (process.platform !== 'win32') {
    const registration = JSON.parse(readFileSync(join(supervisedRoot, reply.id, 'state.json'), 'utf8')) as { pid: number };
    const audit = readFileSync(join(root, 'git-env-audit'), 'utf8').trim().split('\n');
    const runtimeGit = audit.filter((line) => line.startsWith(`${registration.pid} `));
    const launcherGit = audit.filter((line) => line.startsWith(`${child.pid} `));
    expect(runtimeGit.length).toBeGreaterThan(0);
    expect(launcherGit.length).toBeGreaterThan(0);
    expect(launcherGit).not.toContain(`${child.pid} present`);
    expect(runtimeGit).not.toContain(`${registration.pid} present`);
  }
  await stopSupervisedSession(reply.id, supervisedRoot, row.generation);
  expect(telemetryRequests).toBe(0);
  link.close();
  pair.spawnerKey.wipe();
}, 60_000);


it('refuses untrusted project startup after forwarding without granting trust', async () => {
  const root = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'forward-untrusted-')));
  roots.push(root);
  expect(spawnSync('git', ['init', '-q', root]).status).toBe(0);
  const env = createTestBinaryEnvironment(root, { PRODUCT_TELEMETRY_ENABLED: '0' });
  const runtime = createTestProductRuntime('test-product', env);
  const child = spawn(process.execPath, ['--import', tsx, '--import', recorder, '--conditions=source', fixture, 'daemon', 'start', '--spawner-fd=4', '--json'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'] });
  children.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (part: Buffer) => { stdout += part.toString(); });
  child.stderr?.on('data', (part: Buffer) => { stderr += part.toString(); });
  const pipe = child.stdio[4];
  if (!(pipe instanceof Duplex)) throw new Error('Missing desktop spawner pair');
  const pair = await completeSpawnerPair(pipe);
  const [code] = await once(child, 'exit');
  pair.spawnerKey.wipe();
  expect(code).not.toBe(0);
  expect(stderr).toContain('TEST_FORWARD_FD_CLOSED');
  expect(stderr).not.toContain('TEST_PRE_FORWARD_SPAWN');
  expect(stderr).toMatch(/trust/i);
  expect(stdout.trim()).toBe('');
  const rows = await listSupervisedSessions(resolveSupervisedDirectory(runtime));
  expect(rows).toEqual([]);
}, 60_000);

it('refuses the spawner flag in plain mode before starting any child', async () => {
  const root = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'forward-plain-')));
  roots.push(root);
  const env = createTestBinaryEnvironment(root, { PRODUCT_TELEMETRY_ENABLED: '0' });
  const plainEntry = fileURLToPath(new URL('../../bin.ts', import.meta.url));
  const child = spawn(process.execPath, ['--import', tsx, '--import', recorder, '--conditions=source', plainEntry, 'daemon', 'start', '--spawner-fd', '4'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'] });
  children.push(child);
  let stderr = '';
  child.stderr?.on('data', (part: Buffer) => { stderr += part.toString(); });
  const [code] = await once(child, 'exit');
  expect(code).not.toBe(0);
  expect(stderr).toMatch(/only in secure mode/i);
  expect(stderr).not.toContain('TEST_PRE_FORWARD_SPAWN');
}, 30_000);

it('refuses forwarded local startup for valid and invalid hosted posture before spawning', async () => {
  const root = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'forward-hosted-')));
  roots.push(root);
  expect(spawnSync('git', ['init', '-q', root]).status).toBe(0);
  const base = createTestBinaryEnvironment(root, { PRODUCT_TELEMETRY_ENABLED: '0' });
  const runtime = createTestProductRuntime('test-product', base);
  expect(spawnSync(process.execPath, ['--import', tsx, '--conditions=source', fixture, 'trust', '--yes'], { cwd: root, env: base, encoding: 'utf8', timeout: 30_000 }).status).toBe(0);
  const hosted = await hostedFixture();
  try {
    for (const environment of [hosted.environment, { PRODUCT_RUNTIME_POSTURE: 'hosted', PRODUCT_HOSTED_RUNTIME_CONFIG: join(root, 'missing.json') }]) {
      const child = spawn(process.execPath, ['--import', tsx, '--import', recorder, '--conditions=source', fixture, 'daemon', 'start', '--spawner-fd', '4', '--json'], { cwd: root, env: { ...base, ...environment }, stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'] });
      children.push(child);
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (part: Buffer) => { stdout += part.toString(); });
      child.stderr?.on('data', (part: Buffer) => { stderr += part.toString(); });
      const pipe = child.stdio[4];
      if (!(pipe instanceof Duplex)) throw new Error('Missing spawner pipe');
      const pair = completeSpawnerPair(pipe, { timeoutMs: 5_000 }).catch(() => undefined);
      const [code] = await once(child, 'exit');
      (await pair)?.spawnerKey.wipe();
      if (code === 0) {
        const result = JSON.parse(stdout) as { id: string };
        const rows = await listSupervisedSessions(resolveSupervisedDirectory(runtime), undefined, { includeGeneration: true });
        await stopSupervisedSession(result.id, resolveSupervisedDirectory(runtime), rows.find((row) => row.id === result.id)?.generation);
      }
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/hosted runtime admission refused/i);
      expect(stderr).not.toContain('TEST_FORWARD_FD_CLOSED');
    }
  } finally { await hosted.close(); }
}, 60_000);
