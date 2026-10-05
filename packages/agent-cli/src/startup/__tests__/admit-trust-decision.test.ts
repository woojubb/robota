import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorkspaceTrustService, type IWorkspaceIdentity } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { admitStartupTrustDecision } from '../admit-trust-decision.js';

import type { IStartCliOptions } from '../cli-options-types.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Issue #3429 — a trust granted at startup admits project credentials, which are then withheld. */
describe('admitStartupTrustDecision', () => {
  it('withholds a project profile credential once the workspace is trusted', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-admit-trust-')));
    roots.push(root);
    const project = join(root, 'project');
    const runtime = createTestProductRuntime('test-product', { HOME: join(root, 'home') });
    mkdirSync(join(project, runtime.layout.projectDirectory), { recursive: true });
    writeFileSync(
      join(project, runtime.layout.projectDirectory, 'settings.json'),
      JSON.stringify({ providers: { p: { type: 'openai', apiKey: '$ENV:PROJECT_KEY' } } }),
    );
    const identity: IWorkspaceIdentity = { repositoryKey: `fixture:${project}`, displayPath: project, worktreeRoot: project };
    const trusted = await new WorkspaceTrustService({
      identityResolver: { resolve: () => identity },
      projectStateDirectories: runtime.layout.projectStateDirectories,
      store: {
        inspect: async () => ({ state: 'trusted', generation: 1 }),
        grant: async () => ({ state: 'trusted', generation: 1 }),
        revoke: async () => ({ state: 'revoked', generation: 2 }),
      },
    }).inspect(project);
    const startupOptions: IStartCliOptions = { productRuntime: runtime, providerDefinitions: [] };
    const environment: NodeJS.ProcessEnv = { PROJECT_KEY: 'p', PATH: '/bin' };

    admitStartupTrustDecision(startupOptions, trusted, project, environment);

    expect(startupOptions.projectAccess).toBe(trusted);
    expect(environment).toEqual({ PATH: '/bin' });
  });
});
