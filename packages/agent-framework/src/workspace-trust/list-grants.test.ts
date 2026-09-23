/** FLOW-2006 TC-07 — `listGrants()`: read-only, complete, and refusing rather than partial. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createNodeWorkspaceTrustStore } from './node-host-workspace-trust.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function storeFile(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'trust-grants-'));
  dirs.push(dir);
  const file = join(dir, 'workspace-trust.json');
  writeFileSync(file, JSON.stringify(contents), 'utf8');
  return file;
}

const grant = {
  repositoryKey: 'git:1:2:1:2:3:/repo/.git',
  worktreeRoot: '/repo',
  state: 'trusted' as const,
  generation: 1,
  grantedAt: '2026-09-20T00:00:00.000Z',
};

describe('listGrants', () => {
  it('returns every recorded grant with its state, path and generation', async () => {
    const file = storeFile({
      version: 1,
      grants: [grant, { ...grant, worktreeRoot: '/other', state: 'revoked', generation: 2 }],
    });
    const grants = await createNodeWorkspaceTrustStore(file).listGrants?.();
    expect(grants).toHaveLength(2);
    expect(grants?.[0]).toMatchObject({ worktreeRoot: '/repo', state: 'trusted', generation: 1 });
    expect(grants?.[1]).toMatchObject({ worktreeRoot: '/other', state: 'revoked', generation: 2 });
  });

  it('answers an empty list for a store that does not exist yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trust-grants-'));
    dirs.push(dir);
    expect(await createNodeWorkspaceTrustStore(join(dir, 'absent.json')).listGrants?.()).toEqual(
      [],
    );
  });

  it('throws on a corrupt store rather than returning a partial list', async () => {
    const file = storeFile({ version: 1, grants: [{ worktreeRoot: '/repo' }] });
    await expect(createNodeWorkspaceTrustStore(file).listGrants?.()).rejects.toThrow(
      /workspace trust store/,
    );
  });

  it('is read-only: the file is byte-identical after a call', async () => {
    const file = storeFile({ version: 1, grants: [grant] });
    const before = readFileSync(file, 'utf8');
    await createNodeWorkspaceTrustStore(file).listGrants?.();
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});
