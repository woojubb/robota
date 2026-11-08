import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeCanonicalTempDir } from '../testing/canonical-temp-dir.js';
import { WorkspaceAuthorityRequiredError, createAgentRuntime, createQuery } from '../index.js';
import { createTestFrameworkHost } from '../testing/framework-host.js';
import { createTrustedProjectAccessFixture } from '../testing/trusted-project-state-fixture.js';
import { windowsShortSpelling } from '../testing/windows-short-name.js';
import { WorkspaceTrustService } from '../workspace-trust/index.js';
import {
  createNodeWorkspaceIdentityResolver,
  createNodeWorkspaceTrustStore,
} from '../workspace-trust/node-host-workspace-trust.js';
import { createNodeWorkspaceProjectFiles } from '../workspace-trust/node-project-files.js';

import type { TWorkspaceProjectAccess } from '../index.js';

/**
 * A trusted project is bound to one root, and a query or runtime refuses a working directory outside
 * it. Whether `cwd` is inside is decided on real paths, so the check needs the host's
 * `canonicalizePath`: a host that lends none cannot say where `cwd` really is, and the trusted
 * decision is refused instead of being taken on the spelling of a path.
 */
const provider = createScriptedProvider([]).provider;

describe('a trusted project and the host that resolves real paths', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  async function trustedRoot(): Promise<{ root: string; access: TWorkspaceProjectAccess }> {
    const root = makeCanonicalTempDir('trusted-project-cwd-');
    roots.push(root);
    return { root, access: await createTrustedProjectAccessFixture(root) };
  }

  const builders = {
    createQuery: (host: object, cwd: string, projectAccess: TWorkspaceProjectAccess) =>
      createQuery({ host, cwd, provider, projectAccess }),
    createAgentRuntime: (host: object, cwd: string, projectAccess: TWorkspaceProjectAccess) =>
      createAgentRuntime({ host, cwd, provider, projectAccess }),
  };

  describe.each(Object.entries(builders))('%s', (_name, build) => {
    it('refuses a trusted decision when the host lends no canonicalizer', async () => {
      const { root, access } = await trustedRoot();
      const host = createTestFrameworkHost({ canonicalizePath: undefined });
      expect(() => build(host, root, access)).toThrow(WorkspaceAuthorityRequiredError);
      expect(() => build(host, root, access)).toThrow(/host\.canonicalizePath/u);
      expect(() => build({}, root, access)).toThrow(/host\.canonicalizePath/u);
    });

    it('refuses a decision no workspace service minted before it asks for a canonicalizer', async () => {
      const { root } = await trustedRoot();
      const forged = { status: 'trusted', authority: {} } as unknown as TWorkspaceProjectAccess;
      const attempt = (): unknown => build({}, root, forged);
      expect(attempt).toThrow(WorkspaceAuthorityRequiredError);
      expect(attempt).not.toThrow(/canonicalizePath/u);
    });

    it('says the directory cannot be validated when the canonicalizer cannot resolve it', async () => {
      const { root, access } = await trustedRoot();
      const host = createTestFrameworkHost({
        canonicalizePath: () => {
          throw new Error('ENOENT');
        },
      });
      expect(() => build(host, root, access)).toThrow(
        'Trusted project access cannot validate the requested working directory.',
      );
    });

    it('compares the directory the host resolved, not the one it was given', async () => {
      const { root, access } = await trustedRoot();
      const canonicalizePath = vi.fn((path: string) => (path === '/alias' ? root : path));
      const host = createTestFrameworkHost({ canonicalizePath });
      expect(() => build(host, '/alias', access)).not.toThrow();
      expect(canonicalizePath).toHaveBeenCalledWith('/alias');
      expect(() => build(host, '/elsewhere', access)).toThrow(
        'Trusted project access does not cover the requested working directory.',
      );
    });

    it('needs no canonicalizer when the project is Restricted', () => {
      expect(() => build({}, '/workspace', undefined as never)).not.toThrow();
    });
  });
});

/**
 * The trusted root is the workspace identity's spelling of the repository, and the host spells a
 * working directory its own way. A directory the user reaches through a link, or on Windows through an
 * 8.3 short name (`RUNNER~1`), is the same directory: it is covered, not refused as outside the root.
 */
describe('a trusted repository and a working directory spelled another way', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function scratchDirectory(prefix: string): string {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    roots.push(directory);
    return directory;
  }

  async function trustedRepository(): Promise<{
    root: string;
    access: TWorkspaceProjectAccess;
  }> {
    const root = scratchDirectory('trusted-spelling-');
    execFileSync('git', ['init', '--quiet', root], { stdio: 'ignore' });
    const service = new WorkspaceTrustService({
      identityResolver: createNodeWorkspaceIdentityResolver(),
      store: createNodeWorkspaceTrustStore(
        join(scratchDirectory('trusted-spelling-store-'), 'trust.json'),
      ),
      projectFiles: createNodeWorkspaceProjectFiles(),
    });
    const access = await service.grant(root);
    if (access.status !== 'trusted') throw new Error('The repository was not trusted.');
    return { root, access };
  }

  const host = createTestFrameworkHost();
  const provider = createScriptedProvider([]).provider;
  const builders = {
    createQuery: (cwd: string, projectAccess: TWorkspaceProjectAccess) =>
      createQuery({ host, cwd, provider, projectAccess }),
    createAgentRuntime: (cwd: string, projectAccess: TWorkspaceProjectAccess) =>
      createAgentRuntime({ host, cwd, provider, projectAccess }),
  };

  describe.each(Object.entries(builders))('%s', (_name, build) => {
    it('accepts the repository root as written', async () => {
      const { root, access } = await trustedRepository();
      expect(() => build(root, access)).not.toThrow();
    });

    it('accepts a working directory reached through a symlink', async () => {
      const { root, access } = await trustedRepository();
      const alias = join(scratchDirectory('trusted-spelling-alias-'), 'repo');
      symlinkSync(root, alias);
      expect(() => build(alias, access)).not.toThrow();
    });

    it.skipIf(process.platform !== 'win32')(
      'accepts a working directory spelled with an 8.3 short name (Windows only: no other platform has short names)',
      async (context) => {
        const { root, access } = await trustedRepository();
        const short = windowsShortSpelling(root);
        if (short === undefined) context.skip('this volume does not keep 8.3 short names');
        expect(short).not.toBe(root);
        expect(() => build(short as string, access)).not.toThrow();
      },
    );

    it('still refuses a directory that is not in the repository', async () => {
      const { access } = await trustedRepository();
      expect(() => build(scratchDirectory('trusted-spelling-outside-'), access)).toThrow(
        'Trusted project access does not cover the requested working directory.',
      );
    });
  });
});
