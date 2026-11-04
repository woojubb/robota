import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceAuthorityRequiredError, createAgentRuntime, createQuery } from '../index.js';
import { createTestFrameworkHost } from '../testing/framework-host.js';
import { createTrustedProjectAccessFixture } from '../testing/trusted-project-state-fixture.js';

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
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'trusted-project-cwd-')));
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
