import { describe, expect, it } from 'vitest';
import type { IToolWithEventService, TToolParameters } from '@robota-sdk/agent-core';
import {
  E2BSandboxClient,
  InMemorySandboxClient,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from '../index.js';
import type { ISandboxRunOptions, TToolResult } from '../index.js';

async function executeTool(
  tool: IToolWithEventService,
  parameters: TToolParameters,
): Promise<TToolResult> {
  const rawResult = await tool.execute(parameters, { toolName: tool.getName(), parameters });
  return JSON.parse(rawResult.data as string) as TToolResult;
}

describe('sandbox-aware built-in tools', () => {
  it('routes Bash through the injected sandbox client', async () => {
    let observedCommand = '';
    let observedOptions: ISandboxRunOptions | undefined;
    const sandboxClient = new InMemorySandboxClient({
      runHandler: (command, options) => {
        observedCommand = command;
        observedOptions = options;
        return { stdout: 'sandbox stdout', stderr: 'sandbox stderr', exitCode: 7 };
      },
    });

    const result = await executeTool(createBashTool({ sandboxClient }), {
      command: 'npm test',
      timeout: 1234,
      workingDirectory: '/workspace',
    });

    expect(observedCommand).toBe('npm test');
    expect(observedOptions).toEqual({ timeoutMs: 1234, workingDirectory: '/workspace' });
    expect(result).toMatchObject({
      success: true,
      exitCode: 7,
    });
    expect(result.output).toContain('sandbox stdout');
    expect(result.output).toContain('sandbox stderr');
  });

  it('routes Read, Write, and Edit through the injected sandbox filesystem', async () => {
    const sandboxClient = new InMemorySandboxClient({
      files: {
        '/workspace/source.ts': 'const value = 1;\n',
      },
    });

    const readResult = await executeTool(createReadTool({ sandboxClient }), {
      filePath: '/workspace/source.ts',
    });
    expect(readResult.success).toBe(true);
    expect(readResult.output).toContain('1\tconst value = 1;');

    const editResult = await executeTool(createEditTool({ sandboxClient }), {
      filePath: '/workspace/source.ts',
      oldString: 'const value = 1;',
      newString: 'const value = 2;',
    });
    expect(editResult.success).toBe(true);
    expect(sandboxClient.getFile('/workspace/source.ts')).toBe('const value = 2;\n');

    const writeResult = await executeTool(createWriteTool({ sandboxClient }), {
      filePath: '/workspace/generated.ts',
      content: 'export const generated = true;\n',
    });
    expect(writeResult.success).toBe(true);
    expect(sandboxClient.getFile('/workspace/generated.ts')).toBe(
      'export const generated = true;\n',
    );
  });

  it('supports snapshot and restore contracts for sandbox adapters', async () => {
    const sandboxClient = new InMemorySandboxClient({
      files: {
        '/workspace/state.txt': 'before',
      },
    });

    const snapshotId = await sandboxClient.snapshot();
    await sandboxClient.writeFile('/workspace/state.txt', 'after');
    await sandboxClient.restore(snapshotId);

    await expect(sandboxClient.readFile('/workspace/state.txt')).resolves.toBe('before');
  });

  it('adapts E2B-compatible sandboxes without importing the provider SDK', async () => {
    const commandCalls: Array<{ command: string; cwd?: string; timeoutMs?: number }> = [];
    let paused = false;
    let restored = false;
    const e2bSandbox = {
      sandboxId: 'sandbox_1',
      commands: {
        run: async (command: string, options?: { cwd?: string; timeoutMs?: number }) => {
          commandCalls.push({ command, cwd: options?.cwd, timeoutMs: options?.timeoutMs });
          return { stdout: 'ok', stderr: '', exitCode: 0 };
        },
      },
      files: {
        read: async () => 'file content',
        write: async () => undefined,
      },
      pause: async () => {
        paused = true;
      },
      connect: async () => {
        restored = true;
        return e2bSandbox;
      },
    };
    const sandboxClient = new E2BSandboxClient({ sandbox: e2bSandbox });

    await expect(
      sandboxClient.run('pnpm test', { workingDirectory: '/workspace', timeoutMs: 5000 }),
    ).resolves.toEqual({ stdout: 'ok', stderr: '', exitCode: 0 });
    await expect(sandboxClient.readFile('/workspace/file.txt')).resolves.toBe('file content');
    await expect(sandboxClient.snapshot()).resolves.toBe('sandbox_1');
    await sandboxClient.restore('sandbox_1');

    expect(commandCalls).toEqual([{ command: 'pnpm test', cwd: '/workspace', timeoutMs: 5000 }]);
    expect(paused).toBe(true);
    expect(restored).toBe(true);
  });

  it('uses E2B createSnapshot and snapshot restore factories when available', async () => {
    let createdFromSnapshotId = '';
    const restoredSandbox = {
      sandboxId: 'sandbox_from_snapshot',
      commands: {
        run: async () => ({ stdout: 'restored', stderr: '', exitCode: 0 }),
      },
      files: {
        read: async () => 'restored file',
        write: async () => undefined,
      },
    };
    const e2bSandbox = {
      sandboxId: 'sandbox_1',
      commands: {
        run: async () => ({ stdout: 'ok', stderr: '', exitCode: 0 }),
      },
      files: {
        read: async () => 'file content',
        write: async () => undefined,
      },
      createSnapshot: async () => ({ snapshotId: 'snap_1' }),
    };
    const sandboxClient = new E2BSandboxClient({
      sandbox: e2bSandbox,
      createSandboxFromSnapshot: async (snapshotId: string) => {
        createdFromSnapshotId = snapshotId;
        return restoredSandbox;
      },
    });

    await expect(sandboxClient.snapshot()).resolves.toBe('snap_1');
    await sandboxClient.restore('snap_1');

    await expect(sandboxClient.readFile('/workspace/file.txt')).resolves.toBe('restored file');
    expect(createdFromSnapshotId).toBe('snap_1');
  });
});
