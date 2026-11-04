import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { applyInteractiveWorkspaceManifest } from '../interactive-session-init-workspace.js';

import type { IInitOptions } from '../interactive-session-options.js';
import type { ISandboxClient, IWorkspaceManifest } from '@robota-sdk/agent-tools';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'init-workspace-')));
  roots.push(root);
  return root;
}

/** A sandbox that remembers what was written into it. */
function recordingSandbox(): { client: ISandboxClient; written: Map<string, string> } {
  const written = new Map<string, string>();
  const client: ISandboxClient = {
    run: vi.fn(async () => ({ stdout: '', exitCode: 0 })),
    readFile: vi.fn(async () => ''),
    writeFile: vi.fn(async (path: string, content: string) => {
      written.set(path, content);
    }),
  };
  return { client, written };
}

function options(
  host: IInitOptions['host'],
  manifest: IWorkspaceManifest,
  client: ISandboxClient,
): IInitOptions {
  return { host, workspaceManifest: manifest, sandboxClient: client } as IInitOptions;
}

describe('applyInteractiveWorkspaceManifest', () => {
  it('copies a local file and a local directory through the files the host lends, from the session cwd', async () => {
    const cwd = tempRoot();
    mkdirSync(join(cwd, 'docs', 'nested'), { recursive: true });
    writeFileSync(join(cwd, 'note.txt'), 'the note');
    writeFileSync(join(cwd, 'docs', 'a.md'), 'doc a');
    writeFileSync(join(cwd, 'docs', 'nested', 'b.md'), 'doc b');
    // A link is neither a file nor a directory to the copier, and is skipped.
    symlinkSync(join(cwd, 'note.txt'), join(cwd, 'docs', 'link.md'));
    const { client, written } = recordingSandbox();

    await applyInteractiveWorkspaceManifest(
      options(
        createTestFrameworkHost(),
        {
          entries: {
            'copied.txt': { type: 'localFile', src: 'note.txt' },
            docs: { type: 'localDir', src: 'docs' },
          },
        },
        client,
      ),
      cwd,
    );

    expect(Object.fromEntries(written)).toEqual({
      '/workspace/copied.txt': 'the note',
      '/workspace/docs/a.md': 'doc a',
      '/workspace/docs/nested/b.md': 'doc b',
    });
  });

  it('reads through the host’s files, so a host with its own file system is the one consulted', async () => {
    const readFile = vi.fn(async () => 'from the host');
    const base = createTestFrameworkHost();
    const host = createTestFrameworkHost({
      files: { ...base.files!, async: { ...base.files!.async, readFile } },
    });
    const { client, written } = recordingSandbox();

    await applyInteractiveWorkspaceManifest(
      options(host, { entries: { 'x.txt': { type: 'localFile', src: 'anything.txt' } } }, client),
      '/session/cwd',
    );

    expect(readFile).toHaveBeenCalledWith('/session/cwd/anything.txt', 'utf8');
    expect(written.get('/workspace/x.txt')).toBe('from the host');
  });

  it('refuses a local entry on a host that lends no files, naming the entry, before applying anything', async () => {
    const { client, written } = recordingSandbox();
    const host = createTestFrameworkHost({ files: undefined });

    await expect(
      applyInteractiveWorkspaceManifest(
        options(
          host,
          {
            entries: {
              'inline.txt': { type: 'file', content: 'inline' },
              'copied.txt': { type: 'localFile', src: 'note.txt' },
            },
          },
          client,
        ),
        tempRoot(),
      ),
    ).rejects.toThrow(/entry "copied\.txt" is a localFile.*`host\.files`/);
    expect(written.size).toBe(0);
  });

  it('still applies a manifest of inline entries on a host that lends no files', async () => {
    const { client, written } = recordingSandbox();
    await applyInteractiveWorkspaceManifest(
      options(
        createTestFrameworkHost({ files: undefined }),
        { entries: { 'inline.txt': { type: 'file', content: 'inline' } } },
        client,
      ),
      tempRoot(),
    );
    expect(written.get('/workspace/inline.txt')).toBe('inline');
  });
});
