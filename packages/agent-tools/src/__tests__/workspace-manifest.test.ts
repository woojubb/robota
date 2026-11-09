import { resolvePath } from '@robota-sdk/agent-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyWorkspaceManifest,
  InMemorySandboxClient,
  validateWorkspaceManifestPath,
} from '../index.js';
import { createNodeWorkspaceHostFiles } from '../node.js';
import type {
  IWorkspaceHostFiles,
  IWorkspaceManifest,
  IWorkspaceManifestApplyOptions,
} from '../sandbox/types.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-test-workspace-manifest-')));
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
      { hostFiles: createNodeWorkspaceHostFiles(hostRoot), targetRoot: '/workspace' },
    );

    expect(sandboxClient.getFile('/workspace/task.md')).toBe('Task file\n');
    expect(sandboxClient.getFile('/workspace/src/a.txt')).toBe('A\n');
    expect(sandboxClient.getFile('/workspace/src/nested/b.txt')).toBe('B\n');
  });

  it.skipIf(process.platform === 'win32')(
    'reads a Windows-shaped src under the root on POSIX, where it is only a name',
    async () => {
      const hostRoot = createTempDir();
      mkdirSync(join(hostRoot, 'C:'));
      writeFileSync(join(hostRoot, 'C:', 'task.md'), 'Task file\n');
      const sandboxClient = new InMemorySandboxClient();

      await applyWorkspaceManifest(
        sandboxClient,
        { entries: { 'task.md': { type: 'localFile', src: 'C:/task.md' } } },
        { hostFiles: createNodeWorkspaceHostFiles(hostRoot) },
      );

      expect(sandboxClient.getFile('/workspace/task.md')).toBe('Task file\n');
    },
  );

  it('reads an absolute src as written and skips what is neither a file nor a directory', async () => {
    const hostRoot = createTempDir();
    const elsewhere = createTempDir();
    mkdirSync(join(elsewhere, 'tree'));
    writeFileSync(join(elsewhere, 'tree', 'kept.txt'), 'kept\n');
    writeFileSync(join(elsewhere, 'outside.md'), 'outside\n');
    symlinkSync(join(elsewhere, 'outside.md'), join(elsewhere, 'tree', 'link.md'));
    const sandboxClient = new InMemorySandboxClient();

    await applyWorkspaceManifest(
      sandboxClient,
      {
        entries: {
          'outside.md': { type: 'localFile', src: join(elsewhere, 'outside.md') },
          tree: { type: 'localDir', src: join(elsewhere, 'tree') },
        },
      },
      { hostFiles: createNodeWorkspaceHostFiles(hostRoot) },
    );

    expect(sandboxClient.getFile('/workspace/outside.md')).toBe('outside\n');
    expect(sandboxClient.getFile('/workspace/tree/kept.txt')).toBe('kept\n');
    expect(sandboxClient.getFile('/workspace/tree/link.md')).toBeUndefined();
  });

  it('anchors a relative src at the root the host files name', async () => {
    const hostRoot = createTempDir();
    writeFileSync(join(hostRoot, 'task.md'), 'Task file\n');
    const hostFiles = createNodeWorkspaceHostFiles(hostRoot);

    expect(hostFiles.resolve('task.md')).toBe(join(hostRoot, 'task.md'));
    await expect(hostFiles.readText(join(hostRoot, 'task.md'))).resolves.toBe('Task file\n');
    await expect(hostFiles.readDirectory(hostRoot)).resolves.toEqual([
      { name: 'task.md', kind: 'file' },
    ]);
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

describe('workspace manifest host files', () => {
  /** A host with no disk: the applicator may ask only what the port offers. */
  function fakeHostFiles(root: string, tree: Record<string, string>): IWorkspaceHostFiles {
    return {
      resolve: (src) => resolvePath(root, src),
      readText: async (path) => {
        const text = tree[path];
        if (text === undefined) throw new Error(`no such host file: ${path}`);
        return text;
      },
      readDirectory: async (path) => {
        const prefix = `${path}/`;
        const names = new Map<string, 'file' | 'directory'>();
        for (const file of Object.keys(tree)) {
          if (!file.startsWith(prefix)) continue;
          const [first, ...rest] = file.slice(prefix.length).split('/');
          names.set(first!, rest.length > 0 ? 'directory' : 'file');
        }
        return [
          ...[...names].map(([name, kind]) => ({ name, kind })),
          { name: 'socket', kind: 'other' as const },
        ];
      },
    };
  }

  const localManifest: IWorkspaceManifest = {
    entries: {
      'task.md': { type: 'localFile', src: 'task.md' },
      src: { type: 'localDir', src: 'fixture' },
    },
  };

  it('refuses a localFile entry when no host files are given, naming the option', async () => {
    const client = new InMemorySandboxClient();

    await expect(
      applyWorkspaceManifest(client, {
        entries: { 'task.md': { type: 'localFile', src: 'task.md' } },
      }),
    ).rejects.toThrow(/"task\.md" is a localFile.*`hostFiles`/);
  });

  it('refuses a localDir entry when no host files are given, naming the option', async () => {
    const client = new InMemorySandboxClient();

    await expect(
      applyWorkspaceManifest(client, { entries: { src: { type: 'localDir', src: 'fixture' } } }),
    ).rejects.toThrow(/"src" is a localDir.*`hostFiles`/);
  });

  it('refuses before applying any entry, so nothing is half-built', async () => {
    const commands: string[] = [];
    const client = new InMemorySandboxClient({
      runHandler: (command) => {
        commands.push(command);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    });

    await expect(
      applyWorkspaceManifest(client, {
        entries: {
          'first.md': { type: 'file', content: 'inline\n' },
          output: { type: 'dir' },
          'task.md': { type: 'localFile', src: 'task.md' },
        },
      }),
    ).rejects.toThrow(/hostFiles/);

    expect(commands).toEqual([]);
    expect(client.getFile('/workspace/first.md')).toBeUndefined();
  });

  it('applies a manifest with no local entry without host files', async () => {
    const client = new InMemorySandboxClient();

    const result = await applyWorkspaceManifest(client, {
      entries: { 'task.md': { type: 'file', content: 'inline\n' }, output: { type: 'dir' } },
    });

    expect(result.entries.map((entry) => entry.status)).toEqual(['applied', 'applied']);
    expect(client.getFile('/workspace/task.md')).toBe('inline\n');
  });

  it('reads only through the port it is given', async () => {
    const client = new InMemorySandboxClient();
    const hostFiles = fakeHostFiles('/host/project', {
      '/host/project/task.md': 'from the port\n',
      '/host/project/fixture/a.txt': 'A\n',
      '/host/project/fixture/nested/b.txt': 'B\n',
    });

    await applyWorkspaceManifest(client, localManifest, { hostFiles });

    expect(client.getFile('/workspace/task.md')).toBe('from the port\n');
    expect(client.getFile('/workspace/src/a.txt')).toBe('A\n');
    expect(client.getFile('/workspace/src/nested/b.txt')).toBe('B\n');
    expect(client.getFile('/workspace/src/socket')).toBeUndefined();
  });

  it('hands the host files on to a client that applies the manifest itself', async () => {
    const hostFiles = fakeHostFiles('/host/project', {});
    let received: IWorkspaceManifestApplyOptions | undefined;
    const client = new InMemorySandboxClient() as InMemorySandboxClient & {
      applyManifest?: (
        manifest: IWorkspaceManifest,
        options?: IWorkspaceManifestApplyOptions,
      ) => Promise<{ entries: [] }>;
    };
    client.applyManifest = async (_manifest, options) => {
      received = options;
      return { entries: [] };
    };

    await applyWorkspaceManifest(client, localManifest, { hostFiles });

    expect(received?.hostFiles).toBe(hostFiles);
  });
});

describe('unenforceable manifest security controls', () => {
  function manifestWithOneEntry(): IWorkspaceManifest {
    return { entries: { 'task.md': { type: 'file', content: 'Solve this task.\n' } } };
  }

  it('refuses a manifest requesting an environment the built-in applicator cannot apply', async () => {
    const client = new InMemorySandboxClient();
    const manifest = { ...manifestWithOneEntry(), environment: { TOKEN: 'secret' } };

    await expect(applyWorkspaceManifest(client, manifest)).rejects.toThrow(/environment/);
  });

  it('refuses a manifest requesting permissions the built-in applicator cannot apply', async () => {
    const client = new InMemorySandboxClient();
    const manifest = { ...manifestWithOneEntry(), permissions: { read: ['/etc'] } };

    await expect(applyWorkspaceManifest(client, manifest)).rejects.toThrow(/permissions/);
  });

  it('refuses a non-array permissions member a JS caller can supply but the type does not declare', async () => {
    const client = new InMemorySandboxClient();
    // The type says `{ read?: string[]; write?: string[] }`. This package is published, so a
    // JavaScript consumer reaches this function without that check. An array-only emptiness rule
    // would read `.length` off a boolean, get `undefined`, and accept the request unenforced —
    // which is the defect this function exists to refuse.
    const manifest = {
      ...manifestWithOneEntry(),
      permissions: { network: true } as unknown as IWorkspaceManifest['permissions'],
    };

    await expect(applyWorkspaceManifest(client, manifest)).rejects.toThrow(/permissions/);
  });

  it('names both fields when both are requested', async () => {
    const client = new InMemorySandboxClient();
    const manifest = {
      ...manifestWithOneEntry(),
      environment: { TOKEN: 'secret' },
      permissions: { write: ['/tmp'] },
    };

    await expect(applyWorkspaceManifest(client, manifest)).rejects.toThrow(
      /environment and permissions/,
    );
  });

  it('refuses BEFORE applying any entry, so a refused manifest leaves nothing half-built', async () => {
    const client = new InMemorySandboxClient();
    const manifest = { ...manifestWithOneEntry(), environment: { TOKEN: 'secret' } };

    await expect(applyWorkspaceManifest(client, manifest)).rejects.toThrow();
    // The assertion that distinguishes "refused first" from "refused after the work":
    // nothing reached the sandbox.
    await expect(client.readFile('/workspace/task.md')).rejects.toThrow();
  });

  it('accepts declared-but-empty controls, which request nothing', async () => {
    const client = new InMemorySandboxClient();
    const manifest = {
      ...manifestWithOneEntry(),
      environment: {},
      permissions: { read: [], write: [] },
    };

    const result = await applyWorkspaceManifest(client, manifest);
    expect(result.entries).toHaveLength(1);
    // Pins the premise the refusal-ordering case depends on: an APPLIED entry really is readable at
    // this path. Without it, `rejects.toThrow()` over the same path proves only that nothing is
    // there — which a wrong path satisfies just as well. The negative control would become a
    // tautology the day the target root changed, and silently.
    await expect(client.readFile('/workspace/task.md')).resolves.toContain('Solve this task');
  });

  // This records an ACCEPTED HOLE, not coverage: a delegating client still receives `environment`,
  // and this function still cannot tell whether it honoured it. Making that observable needs a wider
  // apply result, which is a published type.
  it('leaves the delegating path alone — a client owning applyManifest is not second-guessed', async () => {
    const manifest = { ...manifestWithOneEntry(), environment: { TOKEN: 'secret' } };
    let received: IWorkspaceManifest | undefined;
    const client = new InMemorySandboxClient() as InMemorySandboxClient & {
      applyManifest?: (m: IWorkspaceManifest) => Promise<{ entries: [] }>;
    };
    client.applyManifest = async (m) => {
      received = m;
      return { entries: [] };
    };

    await expect(applyWorkspaceManifest(client, manifest)).resolves.toEqual({ entries: [] });
    expect(received?.environment).toEqual({ TOKEN: 'secret' });
  });
});
