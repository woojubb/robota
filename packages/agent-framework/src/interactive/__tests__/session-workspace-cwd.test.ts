import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRestrictedWorkspaceProjectAccess } from '../../index.js';
import { makeCanonicalTempDir } from '../../testing/canonical-temp-dir.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { WorkspaceTrustService } from '../../workspace-trust/index.js';
import {
  createNodeWorkspaceIdentityResolver,
  createNodeWorkspaceTrustStore,
} from '../../workspace-trust/node-host-workspace-trust.js';
import { createNodeWorkspaceProjectFiles } from '../../workspace-trust/node-project-files.js';
import { resolveSessionWorkspaceCwd } from '../session-workspace-cwd.js';

import type { TWorkspaceProjectAccess } from '../../index.js';

const host = createTestFrameworkHost();

describe('resolveSessionWorkspaceCwd', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function temporaryDirectory(prefix: string): string {
    const directory = makeCanonicalTempDir(prefix);
    directories.push(directory);
    return directory;
  }

  /** A trusted git repository, with the service that decided it. */
  async function trustedRepository(): Promise<{
    root: string;
    service: WorkspaceTrustService;
    access: TWorkspaceProjectAccess;
  }> {
    const root = temporaryDirectory('session-workspace-cwd-');
    execFileSync('git', ['init', '--quiet', root], { stdio: 'ignore' });
    const service = new WorkspaceTrustService({
      identityResolver: createNodeWorkspaceIdentityResolver(),
      store: createNodeWorkspaceTrustStore(
        join(temporaryDirectory('session-workspace-cwd-store-'), 'trust.json'),
      ),
      projectFiles: createNodeWorkspaceProjectFiles(),
    });
    return { root, service, access: await service.grant(root) };
  }

  it('keeps a directory that is already inside the root as written, without resolving it', async () => {
    const { root, access } = await trustedRepository();
    const nested = join(root, 'packages');
    mkdirSync(nested);
    const canonicalizePath = vi.fn((path: string) => path);
    expect(resolveSessionWorkspaceCwd(nested, access, { canonicalizePath })).toBe(nested);
    expect(canonicalizePath).not.toHaveBeenCalled();
  });

  it('binds the real path of a directory reached through a symlink', async () => {
    const { root, access } = await trustedRepository();
    const link = join(temporaryDirectory('session-workspace-cwd-link-'), 'repo');
    symlinkSync(root, link);
    expect(resolveSessionWorkspaceCwd(link, access, host)).toBe(root);
  });

  it('keeps the spelling when the project is restricted, the host has no canonicalizer or the directory is missing', async () => {
    const { root, access } = await trustedRepository();
    const link = join(temporaryDirectory('session-workspace-cwd-link-'), 'repo');
    symlinkSync(root, link);
    const restricted = createRestrictedWorkspaceProjectAccess('revoked', root);
    expect(resolveSessionWorkspaceCwd(link, restricted, host)).toBe(link);
    expect(resolveSessionWorkspaceCwd(link, access, {})).toBe(link);
    const missing = join(root, '..', 'no-such-directory');
    expect(resolveSessionWorkspaceCwd(missing, access, host)).toBe(missing);
    expect(resolveSessionWorkspaceCwd('', access, host)).toBe('');
  });

  it('keeps the spelling, and does not throw, when the trusted decision has been superseded', async () => {
    const { root, service, access } = await trustedRepository();
    await service.revoke(root);
    const link = join(temporaryDirectory('session-workspace-cwd-link-'), 'repo');
    symlinkSync(root, link);
    expect(resolveSessionWorkspaceCwd(root, access, host)).toBe(root);
    expect(resolveSessionWorkspaceCwd(link, access, host)).toBe(link);
  });
});
