import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandExitError, Sandbox } from 'e2b/dist/index.mjs';
import { createReadTool } from '@robota-sdk/agent-tools';
import { connectE2BTaskWorker } from '../e2b-task-worker.js';
import { admitHostedRuntime } from '../hosted-runtime-admission.js';
import { hostedFixture } from './hosted-fixture.js';

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const signed = await hostedFixture();
  const admission = await admitHostedRuntime({ environment: signed.environment, resume: false });
  if (!admission) throw new Error('no admission');
  const abort = new AbortController();
  const info = {
    sandboxId: admission.config.worker.resource,
    templateId: 'pinned-template-id',
    startedAt: new Date(),
    endAt: new Date(Date.now() + 3000),
    state: 'running' as 'paused' | 'running',
    lifecycle: { onTimeout: 'kill' as 'kill' | 'pause', autoResume: false },
    cpuCount: 1,
    memoryMB: 512,
    envdVersion: 'fixture-version',
    metadata: { ...admission.config.identity, rootTask: 'root-task' },
    allowInternetAccess: false,
    network: { allowPublicTraffic: false, allowOut: [] },
  };
  const sandbox = {
    sandboxId: info.sandboxId,
    commands: { run: vi.fn(async () => ({ exitCode: 0, stdout: 'worker', stderr: '' })) },
    files: {
      read: vi.fn(async () => 'worker-file'),
      write: vi.fn(async () => undefined),
    },
  };
  const getInfo = vi
    .spyOn(Sandbox, 'getInfo')
    .mockImplementation(async () => info as Awaited<ReturnType<typeof Sandbox.getInfo>>);
  const connect = vi.spyOn(Sandbox, 'connect').mockResolvedValue(sandbox as unknown as Sandbox);
  const kill = vi.spyOn(Sandbox, 'kill').mockResolvedValue(true);
  return {
    signed,
    info,
    sandbox,
    getInfo,
    connect,
    kill,
    abort,
    options: {
      admission,
      templateId: info.templateId,
      apiKey: 'disposable-fixture-key',
      signal: abort.signal,
    },
  };
}

describe('E2B admitted worker SDK composition', () => {
  it('refuses timeout pause even when admission has no checkpoint', async () => {
    const f = await fixture();
    try {
      f.info.lifecycle.onTimeout = 'pause';
      await expect(connectE2BTaskWorker(f.options)).rejects.toThrow(/lifecycle/u);
      expect(f.connect).not.toHaveBeenCalled();
      expect(f.kill).not.toHaveBeenCalled();
    } finally {
      await f.signed.close();
    }
  });
  it('refuses a paused resource before its memory or process state can be resumed', async () => {
    const f = await fixture();
    try {
      f.info.state = 'paused';
      await expect(connectE2BTaskWorker(f.options)).rejects.toThrow(/running/u);
      expect(f.connect).not.toHaveBeenCalled();
      expect(f.kill).not.toHaveBeenCalled();
    } finally {
      await f.signed.close();
    }
  });
  it('accepts a signed filesystem checkpoint only on its fresh owner-provisioned worker', async () => {
    const f = await fixture();
    try {
      const snapshot = { id: 'checkpoint-1', digest: 'a'.repeat(64) };
      f.signed.writeConfig({ ...f.signed.config, snapshot });
      f.signed.setProofTransform((proof) => ({ ...proof, snapshot }));
      const admission = await admitHostedRuntime({ environment: f.signed.environment, resume: true });
      if (!admission) throw new Error('no resumed admission');
      f.info.state = 'running';
      Object.assign(f.info.metadata, {
        restoreMode: 'filesystem-v1',
        checkpointId: snapshot.id,
        checkpointDigest: snapshot.digest,
        epoch: String(admission.config.epoch),
        sourceEpoch: '2',
        sourceWorker: 'old-worker',
        sourceRuntime: 'old-runtime',
      });
      const owned = await connectE2BTaskWorker({ ...f.options, admission });
      expect((await owned.client.run('read restored work')).stdout).toBe('worker');
      await owned.release();
    } finally {
      await f.signed.close();
    }
  });

  it.each(['mode', 'digest', 'epoch', 'sourceEpoch', 'sourceWorker', 'sourceRuntime', 'lifecycle'])(
    'refuses an invalid recovery receipt before connecting or deleting: %s', async (fault) => {
      const f = await fixture();
      try {
        const snapshot = { id: 'checkpoint-1', digest: 'a'.repeat(64) };
        f.signed.writeConfig({ ...f.signed.config, snapshot });
        f.signed.setProofTransform((proof) => ({ ...proof, snapshot }));
        const admission = await admitHostedRuntime({ environment: f.signed.environment, resume: true });
        if (!admission) throw new Error('no resumed admission');
        const metadata = {
          restoreMode: 'filesystem-v1', checkpointId: snapshot.id, checkpointDigest: snapshot.digest,
          epoch: '3', sourceEpoch: '2', sourceWorker: 'old-worker', sourceRuntime: 'old-runtime',
        };
        if (fault === 'mode') metadata.restoreMode = 'memory';
        if (fault === 'digest') metadata.checkpointDigest = 'b'.repeat(64);
        if (fault === 'epoch') metadata.epoch = '2';
        if (fault === 'sourceEpoch') metadata.sourceEpoch = '3';
        if (fault === 'sourceWorker') metadata.sourceWorker = f.info.sandboxId;
        if (fault === 'sourceRuntime') metadata.sourceRuntime = admission.config.identity.runtime;
        if (fault === 'lifecycle') f.info.lifecycle.autoResume = true;
        Object.assign(f.info.metadata, metadata);
        await expect(connectE2BTaskWorker({ ...f.options, admission })).rejects.toThrow(/checkpoint|lifecycle/u);
        expect(f.connect).not.toHaveBeenCalled();
        expect(f.kill).not.toHaveBeenCalled();
      } finally {
        await f.signed.close();
      }
    },
  );

  it.each(['tenant', 'task', 'actor', 'runtime', 'rootTask'] as const)(
    'rejects another %s before connecting or deleting its resource',
    async (field) => {
      const f = await fixture();
      try {
        f.info.metadata[field] = 'another-owner';
        await expect(connectE2BTaskWorker(f.options)).rejects.toThrow(/ownership/);
        expect(f.connect).not.toHaveBeenCalled();
        expect(f.kill).not.toHaveBeenCalled();
      } finally {
        await f.signed.close();
      }
    },
  );

  it('keeps the management credential in SDK connection inputs and sends file tools to the worker', async () => {
    const f = await fixture();
    try {
      const owned = await connectE2BTaskWorker(f.options);
      const tool = createReadTool({ cwd: '/workspace', sandboxClient: owned.client });
      const parameters = { filePath: '/workspace/file' };
      const result = await tool.execute(parameters, { toolName: tool.getName(), parameters });
      expect(result.data).toContain('worker-file');
      expect(f.connect).toHaveBeenCalledWith(
        f.info.sandboxId,
        expect.objectContaining({ apiKey: 'disposable-fixture-key' }),
      );
      expect(f.sandbox.files.read).toHaveBeenCalledWith('/workspace/file', {
        signal: f.abort.signal,
      });
      expect(JSON.stringify(f.sandbox.files.read.mock.calls)).not.toContain(
        'disposable-fixture-key',
      );
      await Promise.all([owned.release(), owned.release()]);
      expect(f.kill).toHaveBeenCalledTimes(1);
      await expect(owned.client.readFile('/workspace/file')).rejects.toThrow(/released/);
    } finally {
      await f.signed.close();
    }
  });

  it('preserves SDK nonzero completion receipts and refuses arbitrary transport errors', async () => {
    const f = await fixture();
    try {
      const owned = await connectE2BTaskWorker(f.options);
      f.sandbox.commands.run.mockRejectedValueOnce(
        new CommandExitError({ exitCode: 7, stdout: 'completed', stderr: 'failed command' }),
      );
      await expect(owned.client.run('command')).resolves.toEqual({
        exitCode: 7,
        stdout: 'completed',
        stderr: 'failed command',
      });
      f.sandbox.commands.run.mockRejectedValueOnce(new Error('unknown transport outcome'));
      await expect(owned.client.run('command')).rejects.toThrow(/outcome is unknown/);
      await owned.release();
    } finally {
      await f.signed.close();
    }
  });

  it('deletes an owned resource after a connector failure and reports cleanup failure', async () => {
    const f = await fixture();
    try {
      f.connect.mockRejectedValue(new Error('provider outage'));
      f.kill.mockRejectedValue(new Error('delete outage'));
      await expect(connectE2BTaskWorker(f.options)).rejects.toThrow(/cleanup is unresolved/);
      expect(f.kill).toHaveBeenCalledWith(
        f.info.sandboxId,
        expect.not.objectContaining({ signal: f.abort.signal }),
      );
    } finally {
      await f.signed.close();
    }
  });

  it('withdraws a late file result on abort and retains the deletion result for its owner', async () => {
    const f = await fixture();
    try {
      let finish!: (value: string) => void;
      f.sandbox.files.read.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const owned = await connectE2BTaskWorker(f.options);
      const reading = owned.client.readFile('/workspace/file');
      f.abort.abort();
      finish('stale-task-canary');
      await expect(reading).rejects.toThrow(/released/);
      await owned.release();
      expect(f.kill).toHaveBeenCalledTimes(1);
    } finally {
      await f.signed.close();
    }
  });
  it('cleans an owned worker when cancellation wins the metadata request', async () => {
    const f = await fixture();
    try {
      f.getInfo.mockImplementation(async () => {
        f.abort.abort();
        return f.info as Awaited<ReturnType<typeof Sandbox.getInfo>>;
      });
      await expect(connectE2BTaskWorker(f.options)).rejects.toThrow();
      expect(f.connect).not.toHaveBeenCalled();
      expect(f.kill).toHaveBeenCalledTimes(1);
    } finally {
      await f.signed.close();
    }
  });

  it.each(['metadata', 'connect', 'command', 'read', 'write', 'release'] as const)(
    'does not expose management credentials from a rejected SDK %s operation',
    async (operation) => {
      const f = await fixture();
      try {
        const failure = new Error(`SDK rejected request with ${f.options.apiKey}`);
        const fail = async (): Promise<void> => {
          if (operation === 'metadata') f.getInfo.mockRejectedValue(failure);
          if (operation === 'connect') f.connect.mockRejectedValue(failure);
          const owned = await connectE2BTaskWorker(f.options);
          try {
            if (operation === 'command') {
              f.sandbox.commands.run.mockRejectedValue(failure);
              await owned.client.run('command');
            } else if (operation === 'read') {
              f.sandbox.files.read.mockRejectedValue(failure);
              await owned.client.readFile('/workspace/file');
            } else if (operation === 'write') {
              f.sandbox.files.write.mockRejectedValue(failure);
              await owned.client.writeFile('/workspace/file', 'contents');
            } else if (operation === 'release') {
              f.kill.mockRejectedValue(failure);
            }
          } finally {
            await owned.release();
          }
        };
        await expect(fail()).rejects.not.toThrow(f.options.apiKey);
      } finally {
        await f.signed.close();
      }
    },
  );

  it('pins cloud transport independently of ambient SDK endpoint and debug options', async () => {
    const f = await fixture();
    try {
      const owned = await connectE2BTaskWorker(f.options);
      await owned.release();
      for (const operation of [f.getInfo, f.connect, f.kill]) {
        expect(operation).toHaveBeenCalledWith(
          f.info.sandboxId,
          expect.objectContaining({
            apiUrl: 'https://api.e2b.app',
            sandboxUrl: 'https://sandbox.e2b.app',
            domain: 'e2b.app',
            debug: false,
            retries: 0,
          }),
        );
      }
    } finally {
      await f.signed.close();
    }
  });

  it('deletes again after a cancelled connection finishes resuming the resource', async () => {
    const f = await fixture();
    try {
      let finish!: () => void;
      const order: string[] = [];
      f.connect.mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        order.push('resumed');
        return f.sandbox as unknown as Sandbox;
      });
      f.kill.mockImplementation(async () => {
        order.push('deleted');
        return true;
      });
      const connection = connectE2BTaskWorker(f.options);
      await vi.waitFor(() => expect(f.connect).toHaveBeenCalled());
      f.abort.abort();
      await vi.waitFor(() => expect(f.kill).toHaveBeenCalled());
      finish();
      await expect(connection).rejects.toThrow();
      expect(order.at(-2)).toBe('resumed');
      expect(order.at(-1)).toBe('deleted');
    } finally {
      await f.signed.close();
    }
  });

  it('refuses admission that expired while the SDK connection was pending', async () => {
    const f = await fixture();
    try {
      const now = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      f.connect.mockImplementation(async () => {
        clock.mockReturnValue(f.options.admission.expiresAt);
        return f.sandbox as unknown as Sandbox;
      });
      await expect(connectE2BTaskWorker(f.options)).rejects.toThrow(/expired/);
      expect(f.kill).toHaveBeenCalled();
    } finally {
      await f.signed.close();
    }
  });

  it('retains an unknown resume outcome even when the subsequent delete request succeeds', async () => {
    const f = await fixture();
    try {
      f.connect.mockRejectedValue(new Error('response lost after provider resume dispatch'));
      await expect(connectE2BTaskWorker(f.options)).rejects.toThrow(
        /connection outcome is unknown.*cleanup.*unresolved/,
      );
      expect(f.kill).toHaveBeenCalled();
      expect(f.connect).toHaveBeenCalledWith(
        f.info.sandboxId,
        expect.not.objectContaining({ signal: f.abort.signal }),
      );
    } finally {
      await f.signed.close();
    }
  });
});
