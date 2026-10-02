import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBashTool, createReadTool } from '../index.js';
import { E2BSandboxClient } from '../sandbox/e2b-sandbox-client.js';
import type { IE2BSandboxAdapter } from '../sandbox/e2b-sandbox-client.js';

function adapter(sandboxId = 'worker-1'): IE2BSandboxAdapter {
  return {
    sandboxId,
    commands: { run: vi.fn(async () => ({ stdout: sandboxId, exitCode: 0 })) },
    files: {
      read: vi.fn(async () => `${sandboxId}-canary`),
      write: vi.fn(async () => undefined),
    },
    createSnapshot: vi.fn(async () => ({ snapshotId: `${sandboxId}-checkpoint` })),
  };
}

describe('E2B worker outcomes and restore failures', () => {
  it('surfaces missing completion through the actual Bash tool as a failure', async () => {
    const worker = adapter();
    worker.commands.run = async () => ({ stdout: 'not a completion receipt' });
    const tool = createBashTool({
      sandboxClient: new E2BSandboxClient({ sandbox: worker }),
      cwd: '/workspace',
    });
    const parameters = { command: 'command' };
    const result = await tool.execute(parameters, { toolName: tool.getName(), parameters });
    expect(JSON.parse(result.data as string)).toMatchObject({ success: false });
  });
  it.each([
    {},
    { exitCode: Number.NaN },
    { exitCode: Number.POSITIVE_INFINITY },
    { exitCode: 0.5 },
    { exitCode: '0' },
    { exitCode: null },
    { exitCode: 0, exit_code: 7 },
  ])('refuses an unverified command completion %j', async (result) => {
    const worker = adapter();
    worker.commands.run = async () => result as Awaited<ReturnType<typeof worker.commands.run>>;
    await expect(new E2BSandboxClient({ sandbox: worker }).run('command')).rejects.toThrow(
      /exit code/i,
    );
  });

  it.each(['snapshot', 'connect'] as const)(
    'disables every old-worker operation after a %s factory failure',
    async (kind) => {
      const worker = adapter();
      const fail = async (): Promise<IE2BSandboxAdapter> => {
        throw new Error('backend unavailable');
      };
      const client = new E2BSandboxClient({
        sandbox: worker,
        ...(kind === 'snapshot' ? { createSandboxFromSnapshot: fail } : { connectSandbox: fail }),
      });
      await expect(client.restore('restore-reference')).rejects.toThrow('backend unavailable');
      await expect(client.run('command')).rejects.toThrow(/worker is not available/);
      await expect(client.readFile('/workspace/file')).rejects.toThrow(/worker is not available/);
      await expect(client.writeFile('/workspace/file', 'new')).rejects.toThrow(
        /worker is not available/,
      );
      await expect(client.snapshot()).rejects.toThrow(/worker is not available/);
      expect(worker.commands.run).not.toHaveBeenCalled();
      expect(worker.files.read).not.toHaveBeenCalled();
      expect(worker.files.write).not.toHaveBeenCalled();
      expect(worker.createSnapshot).not.toHaveBeenCalled();
    },
  );

  it('withholds old-worker access throughout an in-flight restore', async () => {
    const worker = adapter();
    let resolve!: (worker: IE2BSandboxAdapter) => void;
    const held = new Promise<IE2BSandboxAdapter>((done) => {
      resolve = done;
    });
    const client = new E2BSandboxClient({
      sandbox: worker,
      createSandboxFromSnapshot: async () => held,
    });
    const restoring = client.restore('checkpoint-1');
    try {
      await expect(client.readFile('/workspace/file')).rejects.toThrow(/worker is not available/);
      expect(worker.files.read).not.toHaveBeenCalled();
    } finally {
      resolve(adapter('worker-2'));
      await restoring;
    }
    await expect(client.readFile('/workspace/file')).resolves.toBe('worker-2-canary');
  });

  it('refuses a connector that returned another worker identity', async () => {
    const wrong = adapter('other-task-worker');
    const client = new E2BSandboxClient({ sandbox: adapter(), connectSandbox: async () => wrong });
    await expect(client.restore('expected-worker')).rejects.toThrow(/identity/);
    await expect(client.readFile('/workspace/file')).rejects.toThrow(/worker is not available/);
    expect(wrong.files.read).not.toHaveBeenCalled();
  });

  it('keeps actual Read on the failed worker path and never returns a host canary', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'e2b-host-canary-'));
    try {
      const file = join(directory, 'host-only.txt');
      const canary = 'HOST_FILE_MUST_NOT_BE_RETURNED';
      writeFileSync(file, canary);
      const worker = adapter();
      const client = new E2BSandboxClient({
        sandbox: worker,
        connectSandbox: async () => {
          throw new Error('backend unavailable');
        },
      });
      await expect(client.restore('expected-worker')).rejects.toThrow('backend unavailable');
      const tool = createReadTool({ sandboxClient: client, cwd: directory });
      const parameters = { filePath: file };
      const result = await tool.execute(parameters, { toolName: tool.getName(), parameters });
      expect(JSON.parse(result.data as string)).toMatchObject({ success: false });
      expect(result.data).not.toContain(canary);
      expect(worker.files.read).not.toHaveBeenCalled();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('accepts the legacy exit-code alias and preserves a known nonzero completion', async () => {
    const worker = adapter();
    worker.commands.run = async () => ({ stdout: 'failed command', exit_code: 7 });
    await expect(new E2BSandboxClient({ sandbox: worker }).run('command')).resolves.toEqual({
      stdout: 'failed command',
      stderr: '',
      exitCode: 7,
    });
  });

  it('allows an already-paused worker reference to remain resumable', async () => {
    const worker = adapter();
    delete worker.createSnapshot;
    worker.pause = async () => false;
    await expect(new E2BSandboxClient({ sandbox: worker }).snapshot()).resolves.toBe('worker-1');
  });

  it('can recover through a successful fresh connector after a failed restore', async () => {
    const worker = adapter();
    let failed = true;
    const client = new E2BSandboxClient({
      sandbox: worker,
      connectSandbox: async (id) => {
        if (failed) throw new Error('backend unavailable');
        return adapter(id);
      },
    });
    await expect(client.restore('worker-2')).rejects.toThrow('backend unavailable');
    failed = false;
    await client.restore('worker-2');
    await expect(client.readFile('/workspace/file')).resolves.toBe('worker-2-canary');
    expect(worker.files.read).not.toHaveBeenCalled();
  });

  it('does not permit competing restores to replace each other out of order', async () => {
    let resolve!: (worker: IE2BSandboxAdapter) => void;
    const held = new Promise<IE2BSandboxAdapter>((done) => {
      resolve = done;
    });
    const factory = vi.fn(async () => held);
    const client = new E2BSandboxClient({ sandbox: adapter(), createSandboxFromSnapshot: factory });
    const restoring = client.restore('checkpoint-1');
    try {
      await expect(client.restore('checkpoint-2')).rejects.toThrow(/already in progress/);
      expect(factory).toHaveBeenCalledOnce();
    } finally {
      resolve(adapter('worker-2'));
      await restoring;
    }
    await expect(client.readFile('/workspace/file')).resolves.toBe('worker-2-canary');
  });

  it('does not return a late result from the previous worker after restoration', async () => {
    const worker = adapter();
    let resolve!: (result: { stdout: string; exitCode: number }) => void;
    worker.commands.run = async () =>
      new Promise((done) => {
        resolve = done;
      });
    const client = new E2BSandboxClient({
      sandbox: worker,
      createSandboxFromSnapshot: async () => adapter('worker-2'),
    });
    const running = client.run('held command').catch((error: Error) => error);
    await client.restore('checkpoint-2');
    resolve({ stdout: 'old-task-canary', exitCode: 0 });
    expect(await running).toBeInstanceOf(Error);
    await expect(client.run('new command')).resolves.toEqual({ stdout: 'worker-2', stderr: '', exitCode: 0 });
  });
});
