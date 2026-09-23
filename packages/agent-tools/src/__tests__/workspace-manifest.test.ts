import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyWorkspaceManifest,
  InMemorySandboxClient,
  validateWorkspaceManifestPath,
} from '../index.js';
import type { IWorkspaceManifest } from '../sandbox/types.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'robota-workspace-manifest-')));
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

describe('unenforceable manifest security controls (TOOL-005 / issue #2027)', () => {
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
  // apply result, which is a published type — tracked on issue #2027.
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
