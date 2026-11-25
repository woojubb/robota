import { createInventoryRuntime as createTestProductRuntime } from './product-runtime.js';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex, PassThrough, Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { childProductEnvironment } from '../../product/child-environment.js';

import type { ISubagentWorkerEntry } from '@robota-sdk/agent-subagent-runner';
import type { IExternalEventGrant } from '@robota-sdk/agent-interface/transport';

const FORWARDED_FD = 57;
const hoisted = vi.hoisted(() => ({
  spawn: vi.fn(),
  closed: [] as number[],
  selfEntry: undefined as (() => unknown) | undefined,
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: hoisted.spawn,
}));

// A stand-in for the descriptor a desktop spawner hands over: it is a socket and closing it is recorded.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    fstatSync: ((fd: number, options?: unknown) =>
      fd === 57
        ? { isSocket: () => true }
        : Reflect.apply(actual.fstatSync, actual, [fd, options])) as typeof actual.fstatSync,
    closeSync: ((fd: number) => {
      if (fd === 57) hoisted.closed.push(fd);
      else actual.closeSync(fd);
    }) as typeof actual.closeSync,
  };
});

// The process's own entry is whatever started the test runner; the launcher's use of it is pinned with a fixed one.
vi.mock('../../subagents/self-fork-worker-entry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../subagents/self-fork-worker-entry.js')>();
  return {
    ...actual,
    resolveSelfForkWorkerEntry: () =>
      (hoisted.selfEntry?.() as ISubagentWorkerEntry | undefined) ??
      actual.resolveSelfForkWorkerEntry(),
  };
});

const { launchForwardedRuntime, launchRuntimeProcess, launchSupervisedSession } =
  await import('../supervised-session-launch.js');

const TOKEN = 'ab12'.repeat(16);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** The signal-disabling flag leads the exec arguments exactly when this runtime accepts it. */
const INSPECTOR_FLAG =
  process.versions.bun === undefined && process.allowedNodeEnvironmentFlags.has('--disable-sigusr1')
    ? ['--disable-sigusr1']
    : [];
const LOADER = ['--import', 'loader.mjs'];

/** What the launcher drives of a spawned child: its channels, its signals and its exit. */
class FakeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  connected = true;
  readonly stderr = new PassThrough();
  readonly received: string[] = [];
  readonly tokenPipe = new Writable({
    write: (chunk: Buffer, _encoding, done) => {
      this.received.push(chunk.toString('utf8'));
      done();
    },
  });
  stdio: unknown[] = [null, null, this.stderr, null, this.tokenPipe];
  readonly sent: unknown[] = [];
  send = vi.fn((message: unknown, done?: (error: Error | null) => void) => {
    this.sent.push(message);
    done?.(null);
    return true;
  });
  disconnect = vi.fn(() => {
    this.connected = false;
  });
  unref = vi.fn();
  kill = vi.fn(() => {
    this.signalCode = 'SIGTERM';
    queueMicrotask(() => this.emit('exit'));
    return true;
  });
}

interface ISpawnCall {
  readonly executable: string;
  readonly args: string[];
  readonly options: { cwd: string; stdio: unknown[]; env: NodeJS.ProcessEnv; detached: boolean };
}

function spawnCall(): ISpawnCall {
  expect(hoisted.spawn).toHaveBeenCalledTimes(1);
  const [executable, args, options] = hoisted.spawn.mock.calls[0] as [
    string,
    string[],
    ISpawnCall['options'],
  ];
  return { executable, args, options };
}

function launchedId(): string {
  const { args } = spawnCall();
  const id = args[args.indexOf('--supervised-session-id') + 1];
  expect(id).toMatch(UUID);
  return id as string;
}

/** The argument list with the one random value in it replaced, so it can be compared exactly. */
function argumentList(): string[] {
  const id = launchedId();
  return spawnCall().args.map((argument) => (argument === id ? '<id>' : argument));
}

/** The child reports ready and acknowledges, as a runtime that started does. */
function completeHandshake(child: FakeChild, grants?: readonly string[]): void {
  const id = launchedId();
  child.emit('message', { kind: 'ready', id, ...(grants === undefined ? {} : { grants }) });
  child.emit('message', { kind: 'acknowledged', id });
}

function grant(grantId: string): IExternalEventGrant {
  return {
    grantId,
    verifier: {
      issuer: 'https://issuer.example',
      resource: `https://test-product.example/events/${grantId}`,
      algorithms: ['ES256'],
      requiredScopes: ['test-product.events.submit'],
      allowedClients: ['client'],
    },
    kinds: ['message'],
  };
}

type TPlainOptions = Parameters<typeof launchSupervisedSession>[1];

function start(options: Partial<TPlainOptions> = {}): Promise<string> {
  return launchSupervisedSession('/work', {
    productRuntime: createTestProductRuntime(),
    entrypoint: 'runtime-entry.ts',
    execArgs: LOADER,
    env: { PATH: '/bin', KEPT: 'yes' },
    ...options,
  });
}

let child: FakeChild;
const roots: string[] = [];

function handoffRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'argument-order-'));
  roots.push(root);
  return root;
}

beforeEach(() => {
  hoisted.spawn.mockReset();
  hoisted.closed.length = 0;
  hoisted.selfEntry = undefined;
  child = new FakeChild();
  hoisted.spawn.mockReturnValue(child);
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('the arguments a supervised launch spawns', () => {
  it('starts a plain runtime with the entry, the serve flag and its id, and nothing else', async () => {
    const launched = start();
    const { executable, options } = spawnCall();
    expect(executable).toBe(process.execPath);
    expect(argumentList()).toEqual([
      ...INSPECTOR_FLAG,
      ...LOADER,
      'runtime-entry.ts',
      '--serve',
      '--supervised-session-id',
      '<id>',
    ]);
    expect(options.cwd).toBe('/work');
    expect(options.detached).toBe(true);
    expect(options.stdio).toEqual(['ignore', 'ignore', 'pipe', 'ipc']);
    expect(options.env).toEqual({ PATH: '/bin', KEPT: 'yes' });
    completeHandshake(child);
    await expect(launched).resolves.toBe(launchedId());
  });

  it('names the runtime', async () => {
    const launched = start({ name: 'Evening review' });
    expect(argumentList()).toEqual([
      ...INSPECTOR_FLAG,
      ...LOADER,
      'runtime-entry.ts',
      '--serve',
      '--supervised-session-id',
      '<id>',
      '--name=Evening review',
    ]);
    completeHandshake(child);
    await launched;
  });

  it('starts the workspace daemon', async () => {
    const launched = start({ daemon: true });
    expect(argumentList()).toEqual([
      ...INSPECTOR_FLAG,
      ...LOADER,
      'runtime-entry.ts',
      '--serve',
      '--supervised-session-id',
      '<id>',
      '--daemon',
    ]);
    expect(spawnCall().options.stdio).toEqual(['ignore', 'ignore', 'pipe', 'ipc']);
    completeHandshake(child);
    await launched;
  });

  it('starts a Restricted runtime', async () => {
    const launched = start({ restricted: true });
    expect(argumentList()).toEqual([
      ...INSPECTOR_FLAG,
      ...LOADER,
      'runtime-entry.ts',
      '--serve',
      '--supervised-session-id',
      '<id>',
      '--restricted-workspace',
    ]);
    completeHandshake(child);
    await launched;
  });

  it('puts the daemon flag before the Restricted flag whatever order the options come in', async () => {
    const launched = start({ restricted: true, daemon: true, name: 'n' });
    expect(argumentList().slice(-5)).toEqual([
      '--supervised-session-id',
      '<id>',
      '--name=n',
      '--daemon',
      '--restricted-workspace',
    ]);
    completeHandshake(child);
    await launched;
  });

  it('hands a token over on a fifth pipe and keeps it out of the arguments and the environment', async () => {
    const launched = start({
      transportToken: TOKEN,
      env: {
        PATH: '/bin',
        KEPT: 'yes',
        PRODUCT_WS_TOKEN: 'c'.repeat(64),
        TEST_PRODUCT_WS_TOKEN: 'd'.repeat(64),
        Test_Product_Ws_Token: 'e'.repeat(64),
        TEST_PRODUCT_WS_TOKEN_EXTRA: 'kept',
        OTHER_WS_TOKEN: 'kept',
      },
    });
    expect(argumentList()).toEqual([
      ...INSPECTOR_FLAG,
      ...LOADER,
      'runtime-entry.ts',
      '--serve',
      '--supervised-session-id',
      '<id>',
      '--supervised-transport-token-fd',
    ]);
    expect(spawnCall().options.stdio).toEqual(['ignore', 'ignore', 'pipe', 'ipc', 'pipe']);
    expect(spawnCall().options.env).toEqual({
      PATH: '/bin',
      KEPT: 'yes',
      TEST_PRODUCT_WS_TOKEN_EXTRA: 'kept',
      OTHER_WS_TOKEN: 'kept',
    });
    expect(spawnCall().args.join(' ')).not.toContain(TOKEN);
    expect(child.received).toEqual([TOKEN]);
    completeHandshake(child);
    await launched;
  });

  it('hands over event grants through a private file and lists every flag in order', async () => {
    const root = handoffRoot();
    const launched = start({
      name: 'All of it',
      grants: [grant('g1'), grant('g2')],
      eventEndpoint: { port: 8123, trustedProxies: ['10.0.0.1', '10.0.0.2'] },
      root,
      transportToken: TOKEN,
      daemon: true,
      restricted: true,
    });
    const id = launchedId();
    expect(argumentList()).toEqual([
      ...INSPECTOR_FLAG,
      ...LOADER,
      'runtime-entry.ts',
      '--serve',
      '--supervised-session-id',
      '<id>',
      '--name=All of it',
      '--supervised-external-event-grants',
      '--supervised-transport-token-fd',
      '--daemon',
      '--restricted-workspace',
      '--external-event-port=8123',
      '--external-event-trusted-proxy=10.0.0.1',
      '--external-event-trusted-proxy=10.0.0.2',
    ]);
    expect(spawnCall().options.stdio).toEqual(['ignore', 'ignore', 'pipe', 'ipc', 'pipe']);
    // The grants wait for the child in one file under the given root, written before it was spawned.
    const file = join(root, `.${id}.grants.json`);
    expect(
      (JSON.parse(readFileSync(file, 'utf8')) as Array<{ grantId: string }>).map(
        (document) => document.grantId,
      ),
    ).toEqual(['g1', 'g2']);
    // The child must open exactly the grants it was given, in any order.
    completeHandshake(child, ['g2', 'g1']);
    await expect(launched).resolves.toBe(id);
    expect(existsSync(file)).toBe(true);
  });

  it('adds no trusted-proxy flag when there are none', async () => {
    const launched = start({
      grants: [grant('g1')],
      eventEndpoint: { port: 9 },
      root: handoffRoot(),
    });
    expect(argumentList().slice(-3)).toEqual([
      '<id>',
      '--supervised-external-event-grants',
      '--external-event-port=9',
    ]);
    completeHandshake(child, ['g1']);
    await launched;
  });

  it('puts the secure pair flag after the name and nothing for a token, on a spawner launch', async () => {
    const pair = new Duplex({ read() {}, write: (_chunk, _encoding, done) => done() });
    child.stdio = [null, null, child.stderr, null, pair];
    const launched = launchRuntimeProcess('/work', {
      productRuntime: createTestProductRuntime(),
      entrypoint: 'runtime-entry.ts',
      execArgs: LOADER,
      name: 'Secure',
      restricted: true,
      mode: 'spawner',
      pairTimeoutMs: 20,
      env: {
        PATH: '/bin',
        KEPT: 'yes',
        PRODUCT_WS_TOKEN: 'c'.repeat(64),
        test_product_ws_token: 'd'.repeat(64),
      },
    });
    expect(argumentList()).toEqual([
      ...INSPECTOR_FLAG,
      ...LOADER,
      'runtime-entry.ts',
      '--serve',
      '--supervised-session-id',
      '<id>',
      '--name=Secure',
      '--supervised-spawner-pair',
      '--restricted-workspace',
    ]);
    expect(spawnCall().options.stdio).toEqual(['ignore', 'ignore', 'pipe', 'ipc', 'pipe']);
    // A secure runtime reads no token from its environment either.
    expect(spawnCall().options.env).toEqual({ PATH: '/bin', KEPT: 'yes' });
    await expect(launched).rejects.toThrow(
      'Supervised session could not complete its spawner exchange.',
    );
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('forwards a handed-over descriptor as the fifth stdio entry and closes its own copy', async () => {
    const launched = launchForwardedRuntime('/work', {
      productRuntime: createTestProductRuntime(),
      entrypoint: 'runtime-entry.ts',
      execArgs: LOADER,
      restricted: true,
      spawnerFd: FORWARDED_FD,
      env: { PATH: '/bin', KEPT: 'yes', TEST_PRODUCT_WS_TOKEN: 'd'.repeat(64) },
    });
    expect(argumentList()).toEqual([
      ...INSPECTOR_FLAG,
      ...LOADER,
      'runtime-entry.ts',
      '--serve',
      '--supervised-session-id',
      '<id>',
      '--supervised-spawner-pair',
      '--restricted-workspace',
    ]);
    expect(spawnCall().options.stdio).toEqual(['ignore', 'ignore', 'pipe', 'ipc', FORWARDED_FD]);
    expect(spawnCall().options.env).toEqual({ PATH: '/bin', KEPT: 'yes' });
    expect(hoisted.closed).toEqual([FORWARDED_FD]);
    completeHandshake(child);
    await expect(launched).resolves.toBe(launchedId());
    expect(hoisted.closed).toEqual([FORWARDED_FD]);
  });

  it('asks for workspace admission, and hands over only the admitted environment, when it prepares one', async () => {
    const prepareEnvironment = vi.fn(async () => ({
      environment: { REFERENCE: 'value', DROPPED: undefined } as NodeJS.ProcessEnv,
      availableCredentialNames: ['REFERENCE'],
    }));
    const launched = launchForwardedRuntime('/work', {
      productRuntime: createTestProductRuntime(),
      entrypoint: 'runtime-entry.ts',
      execArgs: LOADER,
      name: 'Forwarded',
      spawnerFd: FORWARDED_FD,
      prepareEnvironment,
      env: { PATH: '/bin' },
    });
    expect(argumentList()).toEqual([
      ...INSPECTOR_FLAG,
      ...LOADER,
      'runtime-entry.ts',
      '--serve',
      '--supervised-session-id',
      '<id>',
      '--name=Forwarded',
      '--supervised-spawner-pair',
      '--supervised-forwarded-environment',
    ]);
    const id = launchedId();
    child.emit('message', { kind: 'forwarded-environment-needed', id });
    await vi.waitFor(() => expect(child.sent).toHaveLength(1));
    expect(child.sent[0]).toEqual({
      kind: 'forwarded-environment',
      id,
      environment: { REFERENCE: 'value' },
      availableCredentialNames: ['REFERENCE'],
    });
    completeHandshake(child);
    await expect(launched).resolves.toBe(id);
    expect(prepareEnvironment).toHaveBeenCalledTimes(1);
  });

  it('refuses a forwarded environment over the size the child reads', async () => {
    const launched = launchForwardedRuntime('/work', {
      productRuntime: createTestProductRuntime(),
      entrypoint: 'runtime-entry.ts',
      execArgs: LOADER,
      spawnerFd: FORWARDED_FD,
      env: { PATH: '/bin' },
      prepareEnvironment: async () => ({
        environment: { BIG: 'x'.repeat(128 * 1024) },
        availableCredentialNames: [],
      }),
    });
    child.emit('message', { kind: 'forwarded-environment-needed', id: launchedId() });
    await expect(launched).rejects.toThrow(
      'Supervised session admission environment is too large.',
    );
    expect(child.sent).toEqual([]);
  });

  it('reports a runtime that never asked for the admission it was to receive', async () => {
    const launched = launchForwardedRuntime('/work', {
      productRuntime: createTestProductRuntime(),
      entrypoint: 'runtime-entry.ts',
      execArgs: LOADER,
      spawnerFd: FORWARDED_FD,
      env: { PATH: '/bin' },
      prepareEnvironment: async () => ({ environment: {}, availableCredentialNames: [] }),
    });
    completeHandshake(child);
    await expect(launched).rejects.toThrow(
      'Supervised session did not request workspace admission.',
    );
  });
});

describe('the command a supervised launch runs', () => {
  it('runs the explicit command as given and applies no exec arguments or inspector flag to it', async () => {
    const launched = start({
      launchCommand: { executable: '/opt/host', args: ['--sidecar', 'main.js'] },
      entrypoint: 'ignored.js',
      execArgs: ['--import', 'ignored.mjs'],
    });
    const { executable } = spawnCall();
    expect(executable).toBe('/opt/host');
    expect(argumentList()).toEqual([
      '--sidecar',
      'main.js',
      '--serve',
      '--supervised-session-id',
      '<id>',
    ]);
    completeHandshake(child);
    await launched;
  });

  it('runs a copy of itself when no entry or command is given, under the execution flags it was started with', async () => {
    hoisted.selfEntry = () => ({
      execPath: '/self/node',
      args: ['/self/cli.js'],
      execArgv: ['--import', 'self-loader.mjs'],
    });
    const launched = launchSupervisedSession('/work', {
      productRuntime: createTestProductRuntime(),
      env: { PATH: '/bin' },
    });
    expect(spawnCall().executable).toBe('/self/node');
    expect(argumentList()).toEqual([
      ...INSPECTOR_FLAG,
      '--import',
      'self-loader.mjs',
      '/self/cli.js',
      '--serve',
      '--supervised-session-id',
      '<id>',
    ]);
    completeHandshake(child);
    await launched;
  });

  it('runs a copy of itself with explicit exec arguments instead of its own', async () => {
    hoisted.selfEntry = () => ({
      execPath: '/self/node',
      args: ['/self/cli.js'],
      execArgv: ['--import', 'self-loader.mjs'],
    });
    const launched = launchSupervisedSession('/work', {
      productRuntime: createTestProductRuntime(),
      env: { PATH: '/bin' },
      execArgs: ['--stack-size=2000'],
    });
    expect(argumentList()).toEqual([
      ...INSPECTOR_FLAG,
      '--stack-size=2000',
      '/self/cli.js',
      '--serve',
      '--supervised-session-id',
      '<id>',
    ]);
    completeHandshake(child);
    await launched;
  });

  it('runs a copy of itself with nothing but the inspector flag when it has no execution flags', async () => {
    hoisted.selfEntry = () => ({ execPath: '/self/bin', args: [] });
    const launched = launchSupervisedSession('/work', {
      productRuntime: createTestProductRuntime(),
      env: { PATH: '/bin' },
    });
    expect(spawnCall().executable).toBe('/self/bin');
    expect(argumentList()).toEqual([
      ...INSPECTOR_FLAG,
      '--serve',
      '--supervised-session-id',
      '<id>',
    ]);
    completeHandshake(child);
    await launched;
  });

  it('does not add the inspector flag twice', async () => {
    const launched = start({ execArgs: ['--disable-sigusr1', ...LOADER] });
    expect(argumentList()).toEqual([
      '--disable-sigusr1',
      ...LOADER,
      'runtime-entry.ts',
      '--serve',
      '--supervised-session-id',
      '<id>',
    ]);
    completeHandshake(child);
    await launched;
  });

  it('gives the child the product environment when the caller supplies none', async () => {
    const runtime = createTestProductRuntime();
    const launched = launchSupervisedSession('/work', {
      productRuntime: runtime,
      entrypoint: 'runtime-entry.ts',
      execArgs: [],
    });
    expect(spawnCall().options.env).toEqual(childProductEnvironment(runtime));
    completeHandshake(child);
    await launched;
  });
});

describe('the order a supervised launch checks its request in', () => {
  const secureOptions = (extra: Record<string, unknown>) => ({
    productRuntime: createTestProductRuntime(),
    entrypoint: 'runtime-entry.ts',
    execArgs: [],
    env: {},
    mode: 'spawner' as const,
    ...extra,
  });

  it('refuses a bad name before it looks at anything else', async () => {
    await expect(
      start({ name: ' padded', transportToken: 'not-a-token', grants: [grant('g1')] }),
    ).rejects.toThrow('Supervised session name is invalid or too long.');
    await expect(
      launchRuntimeProcess('/work', secureOptions({ name: '', transportToken: TOKEN })),
    ).rejects.toThrow('Supervised session name is invalid or too long.');
    expect(hoisted.spawn).not.toHaveBeenCalled();
  });

  it('refuses a secure runtime that carries a plain token, daemon flag or grants before it judges the token', async () => {
    const message =
      'A secure runtime cannot start with a plain token, daemon flag or external grants.';
    await expect(
      launchRuntimeProcess('/work', secureOptions({ transportToken: 'not-a-token' })),
    ).rejects.toThrow(message);
    await expect(launchRuntimeProcess('/work', secureOptions({ daemon: true }))).rejects.toThrow(
      message,
    );
    await expect(
      launchRuntimeProcess('/work', secureOptions({ grants: [grant('g1')] })),
    ).rejects.toThrow(message);
    await expect(
      launchForwardedRuntime('/work', {
        ...secureOptions({ daemon: true }),
        spawnerFd: FORWARDED_FD,
      }),
    ).rejects.toThrow(message);
    expect(hoisted.spawn).not.toHaveBeenCalled();
  });

  it('judges a malformed token before the grants', async () => {
    await expect(start({ transportToken: 'not-a-token', grants: [grant('g1')] })).rejects.toThrow(
      'Supervised session transport token is invalid.',
    );
    expect(hoisted.spawn).not.toHaveBeenCalled();
  });

  it('refuses grants without an endpoint before it writes or spawns anything', async () => {
    const root = handoffRoot();
    await expect(start({ grants: [grant('g1')], root })).rejects.toThrow(
      'External event grants need the port their endpoint listens on.',
    );
    expect(readdirSync(root)).toEqual([]);
    expect(hoisted.spawn).not.toHaveBeenCalled();
  });

  it('checks the forwarded descriptor before the name', async () => {
    await expect(
      launchForwardedRuntime('/work', { ...secureOptions({ name: ' padded' }), spawnerFd: 2 }),
    ).rejects.toThrow('The spawner descriptor is invalid.');
    await expect(
      launchForwardedRuntime('/work', {
        ...secureOptions({ name: ' padded' }),
        spawnerFd: FORWARDED_FD,
      }),
    ).rejects.toThrow('Supervised session name is invalid or too long.');
    expect(hoisted.spawn).not.toHaveBeenCalled();
  });
});

describe('what a supervised launch reports when the runtime refuses to start', () => {
  async function refusedWith(
    refusal: Record<string, unknown>,
    grants: readonly string[] = ['g1'],
  ): Promise<string> {
    const launched = start({
      grants: grants.map(grant),
      eventEndpoint: { port: 9 },
      root: handoffRoot(),
    });
    const id = launchedId();
    child.emit('message', { kind: 'error', id, ...refusal });
    const error = await launched.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }

  it.each([
    [{ code: 'grant-refused', grant: 'g1' }, 'grant g1: refused by the session.'],
    [{ code: 'grant-refused', grant: 'other' }, 'Supervised session refused to start.'],
    [{ code: 'grant-refused', grant: 'not a grant id!' }, 'Supervised session refused to start.'],
    [{ code: 'grant-refused' }, 'Supervised session refused to start.'],
    [
      { code: 'events-endpoint-failed' },
      'External event endpoint could not be served on its port.',
    ],
    [
      { code: 'daemon-no-endpoint' },
      'The daemon has no WebSocket endpoint; enable the ws transport.',
    ],
    [
      { code: 'control-path-too-long', directory: 'relative/dir' },
      'Supervised session refused to start.',
    ],
    [{ code: 'something-else' }, 'Supervised session refused to start.'],
    [{}, 'Supervised session refused to start.'],
  ])('%j', async (refusal, expected) => {
    await expect(refusedWith(refusal)).resolves.toBe(expected);
  });

  it('names the directory a control socket did not fit under, when the child reports a plain absolute one', async () => {
    const message = await refusedWith({
      code: 'control-path-too-long',
      directory: '/very/long/directory',
    });
    expect(message).toContain('/very/long/directory');
    expect(message).not.toBe('Supervised session refused to start.');
  });

  it('does not take the label of a grant that was never sent', async () => {
    await expect(refusedWith({ code: 'grant-refused', grant: 'g2' }, ['g1'])).resolves.toBe(
      'Supervised session refused to start.',
    );
  });

  it('refuses a runtime that opened other grants than it was given', async () => {
    const launched = start({
      grants: [grant('g1'), grant('g2')],
      eventEndpoint: { port: 9 },
      root: handoffRoot(),
    });
    completeHandshake(child, ['g1']);
    await expect(launched).rejects.toThrow(
      'Supervised session did not open exactly the external event grants it was given.',
    );
  });

  it('refuses a ready runtime that opened grants when it was given none', async () => {
    const launched = start();
    completeHandshake(child, ['g1']);
    await expect(launched).rejects.toThrow(
      'Supervised session did not open exactly the external event grants it was given.',
    );
  });

  it('refuses a message that is not part of the readiness exchange', async () => {
    const launched = start();
    child.emit('message', { kind: 'unexpected', id: launchedId() });
    await expect(launched).rejects.toThrow('Supervised session sent an invalid readiness message.');
  });
});

describe('what a supervised launch leaves behind when it fails', () => {
  it('removes the grant file of a child that died before it was ready', async () => {
    const root = handoffRoot();
    const launched = start({ grants: [grant('g1')], eventEndpoint: { port: 9 }, root });
    const file = join(root, `.${launchedId()}.grants.json`);
    expect(existsSync(file)).toBe(true);
    child.stderr.end();
    child.exitCode = 1;
    child.emit('exit');
    await expect(launched).rejects.toThrow(
      'Supervised session process exited before it was ready.',
    );
    expect(existsSync(file)).toBe(false);
  });

  it('removes the grant file when the spawn itself throws', async () => {
    const root = handoffRoot();
    hoisted.spawn.mockImplementation(() => {
      throw new Error('spawn failed');
    });
    await expect(
      start({ grants: [grant('g1')], eventEndpoint: { port: 9 }, root }),
    ).rejects.toThrow('spawn failed');
    expect(readdirSync(root)).toEqual([]);
  });

  it('ends the child and removes the grant file when the launch observer throws', async () => {
    const root = handoffRoot();
    await expect(
      start({
        grants: [grant('g1')],
        eventEndpoint: { port: 9 },
        root,
        onSpawn: () => {
          throw new Error('observer');
        },
      }),
    ).rejects.toThrow('Supervised session launch observer failed.');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(readdirSync(root)).toEqual([]);
  });

  it('closes a forwarded descriptor it did not hand on, whatever the outcome', async () => {
    hoisted.spawn.mockImplementation(() => {
      throw new Error('spawn failed');
    });
    await expect(
      launchForwardedRuntime('/work', {
        productRuntime: createTestProductRuntime(),
        entrypoint: 'runtime-entry.ts',
        execArgs: [],
        env: {},
        spawnerFd: FORWARDED_FD,
      }),
    ).rejects.toThrow('spawn failed');
    expect(hoisted.closed).toEqual([FORWARDED_FD]);
  });
});
