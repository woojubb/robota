import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyWorkspaceManifest,
  InMemorySandboxClient,
  validateWorkspaceManifestPath,
} from '../index.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'robota-workspace-manifest-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('workspace manifest path validation', () => {
  it('normalizes safe workspace-relative paths', () => {
    expect(validateWorkspaceManifestPath('src//index.ts')).toBe('src/index.ts');
  });

  it('rejects paths that escape the workspace', () => {
    expect(() => validateWorkspaceManifestPath('../secret.txt')).toThrow(
      /workspace manifest path cannot contain traversal/,
    );
  });

  it('rejects absolute paths across POSIX and Windows path styles', () => {
    expect(() => validateWorkspaceManifestPath('/tmp/file.txt')).toThrow(
      /workspace manifest path must be workspace-relative/,
    );
    expect(() => validateWorkspaceManifestPath('C:\\tmp\\file.txt')).toThrow(
      /workspace manifest path must be workspace-relative/,
    );
    expect(() => validateWorkspaceManifestPath('\\tmp\\file.txt')).toThrow(
      /workspace manifest path must be workspace-relative/,
    );
  });

  it('rejects paths that resolve to the workspace root', () => {
    expect(() => validateWorkspaceManifestPath('.')).toThrow(
      /workspace manifest path must not resolve to the workspace root/,
    );
  });
});

describe('workspace manifest application', () => {
  it('applies inline files and empty directories through the sandbox client', async () => {
    const commands: string[] = [];
    const sandboxClient = new InMemorySandboxClient({
      runHandler: (command) => {
        commands.push(command);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    });

    const result = await applyWorkspaceManifest(sandboxClient, {
      entries: {
        'task.md': { type: 'file', content: 'Solve this task.\n' },
        output: { type: 'dir' },
      },
    });

    expect(sandboxClient.getFile('/workspace/task.md')).toBe('Solve this task.\n');
    expect(commands).toContain("mkdir -p '/workspace/output'");
    expect(result.entries).toEqual([
      { path: 'task.md', type: 'file', status: 'applied' },
      { path: 'output', type: 'dir', status: 'applied' },
    ]);
  });

  it('copies host local files and directories into the sandbox target root', async () => {
    const hostRoot = createTempDir();
    mkdirSync(join(hostRoot, 'fixture', 'nested'), { recursive: true });
    writeFileSync(join(hostRoot, 'task.md'), 'Task file\n');
    writeFileSync(join(hostRoot, 'fixture', 'a.txt'), 'A\n');
    writeFileSync(join(hostRoot, 'fixture', 'nested', 'b.txt'), 'B\n');
    const sandboxClient = new InMemorySandboxClient();

    await applyWorkspaceManifest(
      sandboxClient,
      {
        entries: {
          'task.md': { type: 'localFile', src: 'task.md' },
          src: { type: 'localDir', src: 'fixture' },
        },
      },
      { hostRoot, targetRoot: '/workspace' },
    );

    expect(sandboxClient.getFile('/workspace/task.md')).toBe('Task file\n');
    expect(sandboxClient.getFile('/workspace/src/a.txt')).toBe('A\n');
    expect(sandboxClient.getFile('/workspace/src/nested/b.txt')).toBe('B\n');
  });

  it('clones git repositories through sandbox commands with shallow clone by default', async () => {
    const commands: string[] = [];
    const sandboxClient = new InMemorySandboxClient({
      runHandler: (command) => {
        commands.push(command);
        return { stdout: 'cloned', stderr: '', exitCode: 0 };
      },
    });

    await applyWorkspaceManifest(sandboxClient, {
      entries: {
        repo: {
          type: 'gitRepo',
          url: 'https://github.com/example/repo.git',
          ref: 'main',
        },
      },
    });

    expect(commands).toEqual([
      "git clone --depth 1 --branch 'main' 'https://github.com/example/repo.git' '/workspace/repo'",
    ]);
  });

  it('reports provider-specific cloud storage mounts as unsupported for the generic applicator', async () => {
    const sandboxClient = new InMemorySandboxClient();

    const result = await applyWorkspaceManifest(sandboxClient, {
      entries: {
        data: { type: 's3Mount', bucket: 'dataset', region: 'us-east-1' },
      },
    });

    expect(result.entries).toEqual([
      {
        path: 'data',
        type: 's3Mount',
        status: 'unsupported',
        message: 's3Mount requires a provider-specific sandbox adapter.',
      },
    ]);
  });
});
