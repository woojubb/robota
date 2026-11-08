import { execFile, spawn, spawnSync } from 'node:child_process';
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
import { promisify } from 'node:util';

import { completeSpawnerPair } from '@robota-sdk/agent-transport/link';
import { afterEach, expect, it } from 'vitest';

import { createTestBinaryEnvironment, createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { hostedFixture } from '../../hosted/__tests__/hosted-fixture.js';
import { openRegisteredSpawnerLink } from '../owner-link-client.js';
import { listSupervisedSessions, resolveSupervisedDirectory, stopSupervisedSession } from '../supervised-session-control.js';
import { workspaceRootBrokerEndpoint } from '../../startup/workspace-root-broker-process.js';
import { requestWorkspaceRootBroker, startWorkspaceRootBroker } from '../../startup/workspace-root-broker.js';

import type { ChildProcess } from 'node:child_process';

const fixture = fileURLToPath(new URL('../../testing/secure-runtime-entry.ts', import.meta.url));
const recorder = new URL('../../testing/forward-spawn-recorder.mjs', import.meta.url).href;
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const execFileAsync = promisify(execFile);
const roots: string[] = [];
const children: ChildProcess[] = [];
const servers: Server[] = [];
const brokers: Array<{ close(): Promise<void> }> = [];
async function trustWorkspace(runtime: ReturnType<typeof createTestProductRuntime>, root: string): Promise<void> {
  const endpoint = workspaceRootBrokerEndpoint(runtime);
  const directory = process.platform === 'win32' ? join(runtime.layout.userRoot, 'root-broker') : dirname(endpoint);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  brokers.push(await startWorkspaceRootBroker(endpoint, directory, runtime.layout.userPaths.workspaceTrust));
  const prepared = await requestWorkspaceRootBroker(endpoint, { op: 'prepare', root });
  if (prepared.status !== 'prepared') throw new Error('Workspace trust could not be prepared.');
  const approved = await requestWorkspaceRootBroker(endpoint, { op: 'approve', root, candidate: prepared.candidate });
  if (approved.status !== 'trusted') throw new Error('Workspace trust could not be approved.');
}
afterEach(async () => {
  for (const broker of brokers.splice(0)) await broker.close();
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

it.each([false, true])('forwards the pair with project-local provider override: %s', async (projectOverride) => {
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
  const env = createTestBinaryEnvironment(root, { PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_TRACES: 'otlp', PRODUCT_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf', PRODUCT_SYNTHETIC_CREDENTIAL: 'owner-provider-key', FALLBACK_PROVIDER_REF: 'fallback-key', UNSELECTED_PROVIDER_REF: 'unused-fixture', PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` });
  delete env.MISSING_PROVIDER_REF;
  let authorization: string | undefined;
  let fallbackAuthorization: string | undefined;
  let failPrimary = false;
  let telemetryRequests = 0;
  const server = createHttpServer((request, response) => {
    if (request.url === '/v1/traces') {
      telemetryRequests += 1;
      request.resume();
      response.writeHead(200).end();
      return;
    }
    if (request.url?.startsWith('/fallback/')) fallbackAuthorization = request.headers.authorization;
    else {
      authorization = request.headers.authorization;
      if (failPrimary) {
        request.resume();
        response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":{"message":"model unavailable","code":"model_not_found","type":"invalid_request_error"}}');
        return;
      }
    }
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
  writeFileSync(runtime.layout.userPaths.settings, JSON.stringify({ currentProvider: 'openai', fallbackModel: ['backup'], providers: { openai: { type: 'openai', model: 'fixture-model', apiKey: '$ENV:PRODUCT_SYNTHETIC_CREDENTIAL', baseURL: `http://127.0.0.1:${address.port}/v1`, options: { apiSurface: 'chat-completions' } }, backup: { type: 'openai', model: 'fallback-model', apiKey: '$ENV:FALLBACK_PROVIDER_REF', baseURL: `http://127.0.0.1:${address.port}/fallback/v1`, options: { apiSurface: 'chat-completions' } }, unused: { type: 'openai', model: 'unused-model', apiKey: '$ENV:UNSELECTED_PROVIDER_REF' }, missing: { type: 'openai', model: 'missing-model', apiKey: '$ENV:MISSING_PROVIDER_REF' } } }), { mode: 0o600 });
  const projectLocalPath = join(root, runtime.layout.projectSettingsPaths.find((entry) => entry.scope === 'project-local')!.relativePath);
  const launchCwd = projectOverride ? join(root, 'nested') : root;
  if (projectOverride) {
    mkdirSync(dirname(projectLocalPath), { recursive: true });
    writeFileSync(projectLocalPath, JSON.stringify({ currentProvider: 'openai' }), { mode: 0o600 });
    mkdirSync(launchCwd);
  }
  await trustWorkspace(runtime, root);
  telemetryRequests = 0;
  const child = spawn(process.execPath, ['--import', tsx, '--import', recorder, '--conditions=product-source', fixture, 'daemon', 'start', '--spawner-fd', '4', '--json'], { cwd: launchCwd, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'] });
  children.push(child);
  const closed = once(child, 'close');
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (part: Buffer) => { stdout += part.toString(); });
  child.stderr?.on('data', (part: Buffer) => { stderr += part.toString(); });
  const pipe = child.stdio[4];
  if (!(pipe instanceof Duplex)) throw new Error('Missing desktop spawner pair');
  let pair: Awaited<ReturnType<typeof completeSpawnerPair>>;
  try { pair = await completeSpawnerPair(pipe); } catch (error) { throw new Error(`Pair failed: ${stderr}`, { cause: error }); }
  const [code] = await closed;
  expect(code, stderr).toBe(0);
  expect(stderr).toContain('TEST_FORWARD_FD_CLOSED');
  expect(stderr).toContain('TEST_PROVIDER_NAMES selected=true fallback=true unused=false');
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
  failPrimary = true;
  const fallbackComplete = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The configured fallback did not complete.')), 30_000);
    link.session.onMessage((message) => {
      if (message.type === 'complete') { clearTimeout(timer); resolve(); }
      else if (message.type === 'error') { clearTimeout(timer); reject(new Error(`Fallback failed: ${JSON.stringify(message)}`)); }
    });
  });
  link.session.send({ type: 'submit', prompt: 'Exercise the configured fallback' });
  await fallbackComplete;
  expect(fallbackAuthorization).toBe('Bearer fallback-key');
  for (const [name, args, expectation] of [
    ['provider', 'switch unused', /reported.*UNSELECTED_PROVIDER_REF.*set.*not forwarded/i],
    ['model', 'unused-model', /reported.*UNSELECTED_PROVIDER_REF.*set.*not forwarded/i],
    ['provider', 'switch missing', /did not report.*MISSING_PROVIDER_REF.*as set/i],
    ['model', 'missing-model', /did not report.*MISSING_PROVIDER_REF.*as set/i],
  ] as const) {
    const requestId = `switch-${name}-${args}`;
    const command = new Promise<{ success: boolean; message: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The provider switch did not answer.')), 10_000);
      link.session.onMessage((message) => {
        if (message.type === 'command_result' && message.requestId === requestId) { clearTimeout(timer); resolve(message); }
      });
    });
    link.session.send({ type: 'command', name, args, requestId });
    const result = await command;
    expect(result.success).toBe(false);
    expect(result.message).toMatch(expectation);
    expect(result.message).toContain(projectOverride ? projectLocalPath : runtime.layout.userPaths.settings);
    expect(result.message).toMatch(/currentProvider.*stop.*start/i);
  }
  expect(JSON.parse(readFileSync(runtime.layout.userPaths.settings, 'utf8')).currentProvider).toBe('openai');
  const switchBackup = new Promise<{ success: boolean; message: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The admitted provider switch did not answer.')), 10_000);
    link.session.onMessage((message) => {
      if (message.type === 'command_result' && message.requestId === 'switch-backup') { clearTimeout(timer); resolve(message); }
    });
  });
  link.session.send({ type: 'command', name: 'provider', args: 'switch backup', requestId: 'switch-backup' });
  expect((await switchBackup).success).toBe(true);
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
  await execFileAsync(process.execPath, ['--import', tsx, '--conditions=product-source', fixture, 'session', 'stop', reply.id],
    { cwd: root, env, timeout: 30_000 });
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
  const child = spawn(process.execPath, ['--import', tsx, '--import', recorder, '--conditions=product-source', fixture, 'daemon', 'start', '--spawner-fd=4', '--json'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'] });
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
  const child = spawn(process.execPath, ['--import', tsx, '--import', recorder, '--conditions=product-source', plainEntry, 'daemon', 'start', '--spawner-fd', '4'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'] });
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
  await trustWorkspace(runtime, root);
  const hosted = await hostedFixture();
  try {
    for (const environment of [hosted.environment, { PRODUCT_RUNTIME_POSTURE: 'hosted', PRODUCT_HOSTED_RUNTIME_CONFIG: join(root, 'missing.json') }]) {
      const child = spawn(process.execPath, ['--import', tsx, '--import', recorder, '--conditions=product-source', fixture, 'daemon', 'start', '--spawner-fd', '4', '--json'], { cwd: root, env: { ...base, ...environment }, stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'] });
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
