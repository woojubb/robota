import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sandbox } from 'e2b/dist/index.mjs';
import { provisionE2BTaskWorker, E2BWorkerProvisioningError } from '../e2b-worker-provisioning.js';

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const identity = { tenant: 'tenant', task: 'task', rootTask: 'root', actor: 'current-actor', runtime: 'current-runtime' };
  const manifest = {
    version: 1,
    id: 'checkpoint',
    identity: { ...identity, actor: 'revoked-actor', runtime: 'old-runtime' },
    epoch: 2,
    worker: 'old-worker',
    files: [{ path: 'src/work.txt', base64: Buffer.from('restored work').toString('base64') }],
  };
  const checkpoint = Buffer.from(JSON.stringify(manifest));
  const options = {
    identity, epoch: 3, templateId: 'clean-template', apiKey: 'management-canary',
    brokerEndpoint: 'https://broker.example/v1', lifetimeMs: 30_000, requestTimeoutMs: 1000,
    signal: new AbortController().signal,
    snapshot: { id: manifest.id, digest: createHash('sha256').update(checkpoint).digest('hex') },
    checkpoint,
  };
  const written = new Map<string, Uint8Array>();
  const sandbox = {
    sandboxId: 'fresh-worker',
    commands: { run: vi.fn(async () => ({ exitCode: 0, stdout: `/var/tmp/agent-task-${metadata.operationId}-aB01234567\n`, stderr: '' })) },
    files: {
      write: vi.fn(async (path: string, bytes: ArrayBuffer) => { written.set(path, new Uint8Array(bytes)); }),
      read: vi.fn(async (path: string) => written.get(path)!),
    },
  };
  let metadata: Record<string, string> = {};
  const info = {
    sandboxId: sandbox.sandboxId, templateId: options.templateId, state: 'running',
    allowInternetAccess: false,
    network: { allowPublicTraffic: false, allowOut: ['broker.example'] },
    lifecycle: { onTimeout: 'kill', autoResume: false },
  };
  const create = vi.spyOn(Sandbox, 'create').mockImplementation(async (_template, value) => {
    metadata = value!.metadata!;
    return sandbox as unknown as Sandbox;
  });
  const getInfo = vi.spyOn(Sandbox, 'getInfo').mockImplementation(async () => ({ ...info, metadata }) as unknown as Awaited<ReturnType<typeof Sandbox.getInfo>>);
  const kill = vi.spyOn(Sandbox, 'kill').mockResolvedValue(true);
  const resign = (): void => {
    options.checkpoint = Buffer.from(JSON.stringify(manifest));
    options.snapshot.digest = createHash('sha256').update(options.checkpoint).digest('hex');
  };
  return { options, manifest, sandbox, info, create, getInfo, kill, resign };
}

describe('owner-side E2B clean provisioning and filesystem recovery', () => {
  it('creates a clean baseline, restores work bytes, and returns a fresh resource before admission', async () => {
    const f = fixture();
    const result = await provisionE2BTaskWorker(f.options);
    expect(result.resource).toBe('fresh-worker');
    expect(result.workspaceRoot).toBe(`/var/tmp/agent-task-${result.operationId}-aB01234567`);
    expect(f.create).toHaveBeenCalledWith('clean-template', expect.objectContaining({
      apiKey: 'management-canary', envs: {}, allowInternetAccess: false,
      lifecycle: { onTimeout: 'kill', autoResume: false },
      network: { allowPublicTraffic: false, allowOut: ['broker.example'] },
      metadata: expect.objectContaining({ ...f.options.identity, epoch: '3', sourceEpoch: '2', sourceWorker: 'old-worker', restoreMode: 'filesystem-v1' }),
    }));
    expect(f.sandbox.commands.run).toHaveBeenCalledWith(`umask 077; mktemp -d "\${TMPDIR:-/tmp}/agent-task-${result.operationId}-XXXXXXXXXX"`, expect.objectContaining({ cwd: '/', envs: {} }));
    const [path, bytes] = f.sandbox.files.write.mock.calls[0] as unknown as [string, ArrayBuffer];
    expect(path).toBe(`${result.workspaceRoot}/src/work.txt`);
    expect(Buffer.from(bytes).toString()).toBe('restored work');
    expect(JSON.stringify(f.sandbox.commands.run.mock.calls)).not.toContain('management-canary');
    expect(JSON.stringify(f.sandbox.files.write.mock.calls)).not.toContain('management-canary');
    expect(f.kill).not.toHaveBeenCalled();
    await Promise.all([result.release(), result.release()]);
    expect(f.kill).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'relative-root', '/var/tmp/unrelated', '/var/tmp/root\n/var/tmp/other'])('rejects an invalid allocator receipt before restoring files: %s', async (stdout) => {
    const f = fixture();
    f.sandbox.commands.run.mockResolvedValue({ exitCode: 0, stdout, stderr: '' });
    await expect(provisionE2BTaskWorker(f.options)).rejects.toThrow(/workspace/u);
    expect(f.sandbox.files.write).not.toHaveBeenCalled();
    expect(f.kill).toHaveBeenCalledTimes(1);
  });

  it('restores a digest-bound conversation with fresh cwd and no old prompt, metadata or VM state', async () => {
    const f = fixture();
    Object.assign(f.manifest, { version: 2, session: { schemaVersion: 1, record: {
      id: 'saved-session', cwd: '/old', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      systemPrompt: 'old prompt', sandboxSnapshotId: 'old VM',
      messages: [{ id: 'saved-user', role: 'user', content: 'saved work', timestamp: '2026-01-01T00:00:00.000Z', state: 'complete', metadata: { authority: 'old' } }],
    } } });
    f.resign();
    const result = await provisionE2BTaskWorker(f.options);
    expect(result.resumeSession?.path).toBe(`${result.workspaceRoot}/.home/.checkpoint-sessions/saved-session.json`);
    const calls = f.sandbox.files.write.mock.calls;
    const [path, contents] = calls[1] as unknown as [string, ArrayBuffer];
    const bytes = Buffer.from(contents);
    expect(result.resumeSession?.digest).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(path).toBe(result.resumeSession?.path);
    const stored = JSON.parse(bytes.toString()) as { record: Record<string, unknown> };
    expect(stored.record.cwd).toBe(result.workspaceRoot);
    expect(JSON.stringify(stored)).toContain('saved work');
    expect(JSON.stringify(stored)).not.toContain('old');
    expect(f.sandbox.files.read).toHaveBeenCalledWith(path, expect.objectContaining({ format: 'bytes' }));
    await result.release();
  });

  it('rejects malformed conversation state before any allocation', async () => {
    const f = fixture();
    Object.assign(f.manifest, { version: 2, session: { schemaVersion: 999, record: {} } });
    f.resign();
    await expect(provisionE2BTaskWorker(f.options)).rejects.toThrow(/conversation checkpoint/u);
    expect(f.create).not.toHaveBeenCalled();
  });

  it('also provisions a fresh task without restoring a checkpoint', async () => {
    const f = fixture();
    const result = await provisionE2BTaskWorker({ ...f.options, snapshot: null, checkpoint: undefined });
    expect(result.snapshot).toBeNull();
    expect(f.sandbox.files.write).not.toHaveBeenCalled();
    await result.release();
  });

  it('refuses a successful upload receipt whose restored bytes differ', async () => {
    const f = fixture();
    f.sandbox.files.read.mockResolvedValue(Buffer.from('truncated work'));
    await expect(provisionE2BTaskWorker(f.options)).rejects.toThrow(/bytes do not match/u);
    expect(f.kill).toHaveBeenCalledTimes(1);
  });

  it.each(['digest', 'tenant', 'task', 'rootTask', 'runtime', 'epoch', 'path', 'private-state', 'duplicate', 'directory', 'encoding', 'memory'])(
    'refuses an invalid checkpoint before allocating a resource: %s', async (fault) => {
      const f = fixture();
      if (fault === 'digest') f.options.snapshot.digest = 'f'.repeat(64);
      if (['tenant', 'task', 'rootTask'].includes(fault)) f.manifest.identity[fault as 'task'] = 'other';
      if (fault === 'runtime') f.manifest.identity.runtime = f.options.identity.runtime;
      if (fault === 'epoch') f.manifest.epoch = f.options.epoch;
      if (fault === 'path') f.manifest.files[0]!.path = '../host-secret';
      if (fault === 'private-state') f.manifest.files[0]!.path = '.home/settings.json';
      if (fault === 'duplicate') f.manifest.files.push({ ...f.manifest.files[0]! });
      if (fault === 'directory') f.manifest.files.push({ path: 'src', base64: '' });
      if (fault === 'encoding') f.manifest.files[0]!.base64 = 'invalid!';
      if (fault === 'memory') Object.assign(f.manifest, { memory: 'old process state' });
      if (fault !== 'digest') f.resign();
      await expect(provisionE2BTaskWorker(f.options)).rejects.toThrow(/checkpoint/u);
      expect(f.create).not.toHaveBeenCalled();
    },
  );

  it('does not reuse the checkpoint as a provider memory template', async () => {
    const f = fixture();
    await expect(provisionE2BTaskWorker({ ...f.options, templateId: f.options.snapshot.id })).rejects.toThrow(/clean template/u);
    expect(f.create).not.toHaveBeenCalled();
  });

  it.each(['template', 'network', 'lifecycle', 'mkdir', 'write'])(
    'deletes its verified allocation when setup fails: %s', async (fault) => {
      const f = fixture();
      if (fault === 'template') f.info.templateId = 'wrong-template';
      if (fault === 'network') f.info.network.allowPublicTraffic = true;
      if (fault === 'lifecycle') f.info.lifecycle.autoResume = true;
      if (fault === 'mkdir') f.sandbox.commands.run.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'failed' });
      if (fault === 'write') f.sandbox.files.write.mockRejectedValue(new Error('provider error management-canary'));
      await expect(provisionE2BTaskWorker(f.options)).rejects.toThrow(/provisioning|restoration|posture|workspace/u);
      expect(f.kill).toHaveBeenCalledWith('fresh-worker', expect.anything());
    },
  );

  it('preserves allocation uncertainty without deleting an unverified resource', async () => {
    const f = fixture();
    f.getInfo.mockResolvedValue({ ...f.info, metadata: { task: 'other-task' } } as unknown as Awaited<ReturnType<typeof Sandbox.getInfo>>);
    await expect(provisionE2BTaskWorker(f.options)).rejects.toMatchObject({ outcome: 'allocation-unknown', resource: 'fresh-worker', operationId: expect.any(String) });
    expect(f.kill).not.toHaveBeenCalled();
  });

  it('returns a reconciliation identifier when creation has an unknown outcome', async () => {
    const f = fixture();
    f.create.mockRejectedValue(new Error('provider error management-canary'));
    const error = await provisionE2BTaskWorker(f.options).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(E2BWorkerProvisioningError);
    expect(error).toMatchObject({ outcome: 'allocation-unknown', operationId: expect.any(String) });
    expect(String(error)).not.toContain('management-canary');
    expect(f.kill).not.toHaveBeenCalled();
  });

  it('waits for an allocation receipt after abort and deletes its verified new resource', async () => {
    const f = fixture();
    const abort = new AbortController();
    let finish!: () => void;
    const create = f.create.getMockImplementation()!;
    f.create.mockImplementation(async (...args) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      return create(...args);
    });
    const pending = provisionE2BTaskWorker({ ...f.options, signal: abort.signal });
    abort.abort();
    expect(f.kill).not.toHaveBeenCalled();
    finish();
    await expect(pending).rejects.toThrow(/abort/u);
    expect(f.kill).toHaveBeenCalledTimes(1);
    expect(f.sandbox.commands.run).not.toHaveBeenCalled();
  });

  it('reports unresolved cleanup with the verified resource for owner reconciliation', async () => {
    const f = fixture();
    f.sandbox.files.write.mockRejectedValue(new Error('upload failed'));
    f.kill.mockRejectedValue(new Error('provider error management-canary'));
    await expect(provisionE2BTaskWorker(f.options)).rejects.toMatchObject({ outcome: 'cleanup-unresolved', resource: 'fresh-worker', operationId: expect.any(String) });
  });
});
