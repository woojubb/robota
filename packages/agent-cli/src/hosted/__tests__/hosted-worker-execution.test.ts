import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sandbox } from 'e2b/dist/index.mjs';
import { createTestProductEnvironment } from '../../__tests__/helpers/product-runtime.js';
import { hostedFixture } from './hosted-fixture.js';
import { admitHostedRuntime } from '../hosted-runtime-admission.js';
import { createE2BHostedRuntimeExecutorFactory } from '../e2b-hosted-executor.js';
import { runHostedRuntime } from '../hosted-runtime-startup.js';
import {
  decodeHostedWorkerExecutionConfig,
  verifyHostedWorkerAccess,
} from '../hosted-worker-execution-config.js';

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const signed = await hostedFixture();
  const admission = await admitHostedRuntime({ environment: signed.environment, resume: false });
  if (!admission) throw new Error('fixture did not admit');
  const product = Object.entries(createTestProductEnvironment('cedar'))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const entry = 'process.stdout.write("worker CLI fixture");';
  const access = signed.signWorkerAccess({
    version: 1,
    identity: admission.config.identity,
    epoch: admission.config.epoch,
    worker: admission.config.worker.resource,
    broker: admission.config.broker.resource,
    endpoint: new URL('/v1', admission.config.broker.endpoint).href,
    token: 'synthetic-task-credential',
    issuedAt: Date.now(),
    expiresAt: admission.expiresAt,
  });
  const config = {
    version: 1,
    templateId: 'pinned-template',
    nodeExecutable: '/usr/local/bin/node',
    workspaceRoot: '/workspace',
    access,
    entrypoint: {
      path: '/opt/agent/cli.mjs',
      digest: createHash('sha256').update(entry).digest('hex'),
    },
    productConfig: {
      path: '/opt/agent/product.env',
      digest: createHash('sha256').update(product).digest('hex'),
    },
  };
  const file = join(signed.directory, 'execution.json');
  writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  const environment = {
    ...signed.environment,
    PRODUCT_HOSTED_WORKER_EXECUTION_CONFIG: file,
    PRODUCT_E2B_API_KEY: 'management-canary-never-projected',
    ANTHROPIC_API_KEY: 'upstream-canary-never-projected',
  };
  const handle = {
    pid: 123,
    wait: vi.fn(async () => ({ exitCode: 0 })),
    sendStdin: vi.fn(async (_data: string | Uint8Array) => undefined),
    closeStdin: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  };
  const run = vi.fn(
    async (
      _command: string,
      options?: { background?: boolean; onStdout?: (data: string) => void },
    ) => {
      if (options?.background) {
        options.onStdout?.('worker CLI output');
        return handle;
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  );
  const sandbox = {
    sandboxId: admission.config.worker.resource,
    commands: { run },
    files: {
      read: vi.fn(async (path: string) => (path === config.entrypoint.path ? entry : product)),
      write: vi.fn(async (_path: string, _content: string) => undefined),
    },
    pty: {
      create: vi.fn(async () => handle),
      resize: vi.fn(async () => undefined),
      sendInput: vi.fn(async (_pid: number, _data: Uint8Array) => undefined),
    },
  };
  const info = {
    sandboxId: sandbox.sandboxId,
    templateId: config.templateId,
    state: 'running',
    lifecycle: { onTimeout: 'kill', autoResume: false },
    metadata: { ...admission.config.identity },
    allowInternetAccess: false,
    network: { allowPublicTraffic: false, allowOut: ['127.0.0.1'] },
  };
  const getInfo = vi
    .spyOn(Sandbox, 'getInfo')
    .mockResolvedValue(info as unknown as Awaited<ReturnType<typeof Sandbox.getInfo>>);
  const connect = vi.spyOn(Sandbox, 'connect').mockResolvedValue(sandbox as unknown as Sandbox);
  const kill = vi.spyOn(Sandbox, 'kill').mockResolvedValue(true);
  const input = new PassThrough();
  input.end('worker input');
  const output = new PassThrough();
  const error = new PassThrough();
  let stdout = '';
  output.on('data', (data: Buffer) => {
    stdout += data.toString();
  });
  return {
    signed,
    admission,
    config,
    access,
    file,
    environment,
    sandbox,
    info,
    getInfo,
    connect,
    kill,
    handle,
    io: { input, output, error },
    stdout: () => stdout,
  };
}

async function resumeFixture() {
  const f = await fixture();
  const snapshot = { id: 'checkpoint', digest: 'c'.repeat(64) };
  f.signed.writeConfig({ ...f.signed.config, snapshot });
  f.signed.setProofTransform((proof) => ({ ...proof, snapshot }));
  const admission = await admitHostedRuntime({ environment: f.environment, resume: true });
  if (!admission) throw new Error('fixture did not admit resume');
  Object.assign(f.info.metadata, { epoch: '3', sourceEpoch: '2', sourceWorker: 'old-worker', sourceRuntime: 'old-runtime', restoreMode: 'filesystem-v1', checkpointId: snapshot.id, checkpointDigest: snapshot.digest });
  const session = JSON.stringify({ schemaVersion: 1, record: {
    id: 'saved-session', cwd: '/old', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    systemPrompt: 'old prompt', sandboxSnapshotId: 'old VM',
    messages: [{ id: 'saved-user', role: 'user', content: 'saved work', timestamp: '2026-01-01T00:00:00.000Z', state: 'complete', metadata: { authority: 'old' } }],
  } });
  const resumeSession = { id: 'saved-session', path: '/workspace/.home/.checkpoint-sessions/saved-session.json', digest: createHash('sha256').update(session).digest('hex') };
  const config = { ...f.config, resumeSession };
  writeFileSync(f.file, JSON.stringify(config));
  const written = new Map<string, string>();
  f.sandbox.files.write.mockImplementation(async (path, content) => { written.set(path, content); });
  f.sandbox.files.read.mockImplementation(async (path) => written.get(path) ?? (
    path === config.entrypoint.path ? 'process.stdout.write("worker CLI fixture");' :
      path === resumeSession.path ? session :
        Object.entries({ ...createTestProductEnvironment('cedar'), PRODUCT_USER_STATE_DIR: '/private/task-user' }).map(([key, value]) => `${key}=${value}`).join('\n')
  ));
  const product = await f.sandbox.files.read(config.productConfig.path);
  config.productConfig = { ...config.productConfig, digest: createHash('sha256').update(product).digest('hex') };
  writeFileSync(f.file, JSON.stringify(config));
  return { ...f, admission, config, session, written };
}

describe('installed hosted worker CLI composition', () => {
  it('refuses serve without owner-selected ingress before provider connection', async () => {
    const f = await fixture();
    try {
      await expect(createE2BHostedRuntimeExecutorFactory(f.environment, f.io)(f.admission,
        new AbortController().signal, { mode: 'serve', argv: ['--serve'], resume: false })).rejects.toThrow(/loopback ingress/u);
      expect(f.connect).not.toHaveBeenCalled();
    } finally { await f.signed.close(); }
  });

  it.each([
    { port: -1, workerPort: 7070, token: 'a'.repeat(32) },
    { port: 0, workerPort: 0, token: 'a'.repeat(32) },
    { port: 0, workerPort: 7070, token: 'short' },
    { port: 0, workerPort: 7070, token: 'a'.repeat(32), host: '0.0.0.0' },
  ])('refuses invalid or widened serve ingress configuration', async (serve) => {
    const f = await fixture();
    try {
      expect(() => decodeHostedWorkerExecutionConfig({ ...f.config, serve }, f.admission)).toThrow(/serve ingress/u);
    } finally { await f.signed.close(); }
  });
  it('copies only conversation into current user state before dispatching a scoped credential', async () => {
    const f = await resumeFixture();
    try {
      const executor = await createE2BHostedRuntimeExecutorFactory(f.environment, f.io)(f.admission,
        new AbortController().signal, { mode: 'headless', argv: ['--resume', 'saved-session'], resume: true });
      const restored = f.written.get('/private/task-user/sessions/saved-session.json');
      expect(restored).toContain('saved work');
      expect(restored).not.toContain('old');
      expect(JSON.parse(restored!).record.cwd).toBe('/workspace');
      expect(f.handle.wait).not.toHaveBeenCalled();
      await executor.release();
    } finally { await f.signed.close(); }
  });

  it.each(['digest', 'record-id', 'malformed', 'readback', 'existing-state'])(
    'refuses invalid conversation restoration and deletes its worker before CLI dispatch: %s', async (fault) => {
      const f = await resumeFixture();
      try {
        if (fault === 'digest') f.config.resumeSession.digest = 'f'.repeat(64);
        if (fault === 'record-id' || fault === 'malformed') {
          const content = fault === 'record-id' ? f.session.replace('"saved-session"', '"another-session"') : '{broken JSON';
          f.config.resumeSession.digest = createHash('sha256').update(content).digest('hex');
          const original = f.sandbox.files.read.getMockImplementation()!;
          f.sandbox.files.read.mockImplementation(async (path) => path === f.config.resumeSession.path ? content : original(path));
        }
        if (fault === 'readback') f.sandbox.files.write.mockResolvedValue(undefined);
        if (fault === 'existing-state') f.sandbox.commands.run.mockImplementation(async (command) => ({ exitCode: command.startsWith('test ! -e') ? 1 : 0, stdout: '', stderr: '' }) as never);
        writeFileSync(f.file, JSON.stringify(f.config));
        await expect(createE2BHostedRuntimeExecutorFactory(f.environment, f.io)(f.admission,
          new AbortController().signal, { mode: 'headless', argv: ['--resume', 'saved-session'], resume: true })).rejects.toThrow(/conversation/u);
        expect(f.kill).toHaveBeenCalledTimes(1);
        expect(f.sandbox.commands.run.mock.calls.some(([, options]) => options?.background)).toBe(false);
      } finally { await f.signed.close(); }
    },
  );

  it.each(['missing', 'wrong-selector', 'outside-private-state'])(
    'refuses a missing or misbound resume receipt before provider connection: %s', async (fault) => {
      const f = await resumeFixture();
      try {
        const config: Record<string, unknown> = { ...f.config };
        if (fault === 'missing') delete config.resumeSession;
        if (fault === 'outside-private-state') f.config.resumeSession.path = '/workspace/model-controlled-session.json';
        writeFileSync(f.file, JSON.stringify(config));
        await expect(createE2BHostedRuntimeExecutorFactory(f.environment, f.io)(f.admission,
          new AbortController().signal, { mode: 'headless', argv: ['--resume', fault === 'wrong-selector' ? 'another-session' : 'saved-session'], resume: true })).rejects.toThrow(/checkpoint/u);
        expect(f.connect).not.toHaveBeenCalled();
        expect(f.sandbox.commands.run).not.toHaveBeenCalled();
      } finally { await f.signed.close(); }
    },
  );

  it('refuses a host scheduling function that cannot cross the task-worker boundary', async () => {
    const f = await fixture();
    const argv = [...process.argv];
    try {
      process.argv.splice(2, process.argv.length, '--help');
      await expect(runHostedRuntime({ toolExecutionPolicy: () => ({}) }, f.environment, 'cedar'))
        .rejects.toThrow(/scheduling.*worker/u);
      expect(f.sandbox.commands.run).not.toHaveBeenCalled();
      expect(f.kill).not.toHaveBeenCalled();
    } finally {
      process.argv.splice(0, process.argv.length, ...argv);
      await f.signed.close();
    }
  });

  it('uses the stock default executor after signed admission without an injected executor factory', async () => {
    const f = await fixture();
    const argv = [...process.argv];
    try {
      process.argv.splice(2, process.argv.length, '--help');
      await runHostedRuntime({}, f.environment, 'cedar');
      expect(f.sandbox.commands.run).toHaveBeenCalledWith(
        expect.stringContaining("'/opt/agent/cli.mjs' '--help'"),
        expect.objectContaining({ background: true, stdin: true, cwd: '/workspace' }),
      );
      expect(f.kill).toHaveBeenCalledTimes(1);
    } finally {
      process.argv.splice(0, process.argv.length, ...argv);
      await f.signed.close();
    }
  });

  it.each(['headless', 'serve', 'mcp', 'interactive', 'command'] as const)(
    'runs %s inside the worker with a closed environment and preserves arguments',
    async (mode) => {
      const f = await fixture();
      try {
        if (mode === 'serve') writeFileSync(f.file, JSON.stringify({ ...f.config,
          serve: { port: 0, workerPort: 7070, token: 'synthetic-owner-client-token-123456789' } }));
        const abort = new AbortController();
        const executor = await createE2BHostedRuntimeExecutorFactory(f.environment, f.io)(
          f.admission,
          abort.signal,
          { mode, argv: ['-p', "quoted'; $(touch host-canary)", '--safe-mode'], resume: false },
        );
        await executor.run(f.admission, { signal: abort.signal, observe: vi.fn() });
        const calls =
          mode === 'interactive'
            ? f.sandbox.pty.create.mock.calls
            : f.sandbox.commands.run.mock.calls;
        expect(JSON.stringify(calls)).not.toContain('management-canary');
        expect(JSON.stringify(calls)).not.toContain('upstream-canary');
        if (mode === 'interactive') {
          expect(f.sandbox.pty.create).toHaveBeenCalledWith(
            expect.objectContaining({ cwd: '/workspace' }),
          );
          expect(Buffer.from(f.sandbox.pty.sendInput.mock.calls[0]?.[1] ?? []).toString()).toMatch(
            /^exec \/bin\/bash -c \$'/u,
          );
        } else {
          expect(f.stdout()).toEqual(mode === 'serve' ? expect.stringContaining('Hosted runtime daemon: ws://127.0.0.1:') : 'worker CLI output');
          expect(f.sandbox.commands.run).toHaveBeenCalledWith(
            expect.stringContaining('exec env -i'),
            expect.objectContaining({ envs: expect.objectContaining({ AGENT_TASK_BROKER_TOKEN: f.access.token }) }),
          );
        }
        await executor.stop('completed');
        await executor.release();
        expect(f.kill).toHaveBeenCalledTimes(1);
      } finally {
        await f.signed.close();
      }
    },
  );

  it.each(['rootTask', 'task', 'actor', 'tenant', 'runtime'] as const)(
    'refuses a broker-signed credential for another %s before SDK connection',
    async (key) => {
      const f = await fixture();
      try {
        const other = f.signed.signWorkerAccess({
          ...f.access,
          identity: { ...f.access.identity, [key]: 'other' },
        });
        expect(() => verifyHostedWorkerAccess(other, f.admission)).toThrow(
          /another admitted authority/,
        );
        expect(f.connect).not.toHaveBeenCalled();
      } finally {
        await f.signed.close();
      }
    },
  );

  it('refuses unsigned upstream-key substitution and a broker endpoint outside its admitted origin', async () => {
    const f = await fixture();
    try {
      expect(() =>
        verifyHostedWorkerAccess({ ...f.access, token: 'some-upstream-key' }, f.admission),
      ).toThrow(/signature/);
      expect(() =>
        verifyHostedWorkerAccess(
          f.signed.signWorkerAccess({ ...f.access, endpoint: 'https://another.example/v1' }),
          f.admission,
        ),
      ).toThrow(/endpoint/);
      expect(() =>
        decodeHostedWorkerExecutionConfig(
          { ...f.config, workspaceRoot: '/work/../runtime' },
          f.admission,
        ),
      ).toThrow(/normalized/);
    } finally {
      await f.signed.close();
    }
  });

  it('refuses an artifact mismatch and releases the owned worker before any CLI dispatch', async () => {
    const f = await fixture();
    try {
      f.sandbox.files.read.mockResolvedValue('corrupted');
      await expect(
        createE2BHostedRuntimeExecutorFactory(f.environment, f.io)(
          f.admission,
          new AbortController().signal,
          { mode: 'headless', argv: [], resume: false },
        ),
      ).rejects.toThrow(/digest/);
      expect(f.sandbox.commands.run).not.toHaveBeenCalled();
      expect(f.kill).toHaveBeenCalledTimes(1);
    } finally {
      await f.signed.close();
    }
  });

  it('refuses extra public egress before a worker CLI can receive its task credential', async () => {
    const f = await fixture();
    try {
      f.info.network.allowOut.push('0.0.0.0/0');
      await expect(
        createE2BHostedRuntimeExecutorFactory(f.environment, f.io)(
          f.admission,
          new AbortController().signal,
          { mode: 'headless', argv: [], resume: false },
        ),
      ).rejects.toThrow(/network/);
      expect(f.connect).not.toHaveBeenCalled();
      expect(f.sandbox.commands.run).not.toHaveBeenCalled();
    } finally {
      await f.signed.close();
    }
  });

  it('refuses attached provider volumes before dispatching a scoped task credential', async () => {
    const f = await fixture();
    try {
      Object.assign(f.info, { volumeMounts: [{ name: 'shared-volume', mountPath: '/shared' }] });
      await expect(
        createE2BHostedRuntimeExecutorFactory(f.environment, f.io)(
          f.admission,
          new AbortController().signal,
          { mode: 'headless', argv: [], resume: false },
        ),
      ).rejects.toThrow(/configuration/);
      expect(f.connect).not.toHaveBeenCalled();
      expect(f.sandbox.commands.run).not.toHaveBeenCalled();
    } finally {
      await f.signed.close();
    }
  });

  it('uses the real SDK PTY handle without its unsupported stdin methods', async () => {
    const f = await fixture();
    try {
      const actual = new Sandbox({
        sandboxId: 'sdk-pty-fixture',
        envdVersion: '0.3.0',
        apiKey: 'fixture-key',
        debug: false,
      });
      let finish!: () => void;
      const finishing = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const events = (async function* () {
        yield { event: { event: { case: 'start', value: { pid: 456 } } } };
        await finishing;
        yield { event: { event: { case: 'end', value: { exitCode: 0, error: '' } } } };
      })();
      // Replace only RPC transport; the actual SDK creates its actual PTY handle.
      (actual.pty as unknown as { rpc: { start: () => unknown } }).rpc = { start: () => events };
      const handle = await actual.pty.create({ cols: 80, rows: 24, onData: () => undefined });
      f.sandbox.pty.create.mockResolvedValue(handle as unknown as typeof f.handle);
      const abort = new AbortController();
      const executor = await createE2BHostedRuntimeExecutorFactory(f.environment, f.io)(
        f.admission,
        abort.signal,
        { mode: 'interactive', argv: [], resume: false },
      );
      const running = executor.run(f.admission, { signal: abort.signal, observe: vi.fn() });
      await vi.waitFor(() => {
        const sent = f.sandbox.pty.sendInput.mock.calls.map(([, bytes]) => Buffer.from(bytes));
        expect(sent.some((bytes) => bytes.toString() === 'worker input')).toBe(true);
        expect(sent.some((bytes) => bytes.equals(Buffer.from([3])))).toBe(true);
      });
      finish();
      await running;
      expect(f.sandbox.pty.sendInput).toHaveBeenCalledWith(456, expect.any(Uint8Array));
      await executor.stop('completed');
    } finally {
      await f.signed.close();
    }
  });

  it('disconnects an allocated SDK stream when cancellation wins its dispatch receipt', async () => {
    const f = await fixture();
    try {
      const abort = new AbortController();
      const executor = await createE2BHostedRuntimeExecutorFactory(f.environment, f.io)(
        f.admission,
        abort.signal,
        { mode: 'interactive', argv: [], resume: false },
      );
      f.sandbox.pty.create.mockImplementation(async () => {
        abort.abort();
        return f.handle;
      });
      await expect(
        executor.run(f.admission, { signal: abort.signal, observe: vi.fn() }),
      ).rejects.toThrow();
      expect(f.handle.disconnect).toHaveBeenCalledTimes(1);
      await executor.stop('cancelled');
    } finally {
      await f.signed.close();
    }
  });
});
