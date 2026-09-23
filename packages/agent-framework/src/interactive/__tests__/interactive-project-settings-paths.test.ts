import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadInteractiveProjectConfig } from '../interactive-session-project-context.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { createRestrictedWorkspaceProjectAccess } from '../../workspace-trust/index.js';

const directories: string[] = [];

function tempDirectory(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'robota-project-settings-paths-')));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('interactive project settings paths', () => {
  it('reads only host-selected paths after trust and no project path while restricted', async () => {
    const root = tempDirectory();
    vi.stubEnv('HOME', tempDirectory());
    mkdirSync(join(root, '.custom'), { recursive: true });
    mkdirSync(join(root, '.robota'), { recursive: true });
    writeFileSync(join(root, '.custom', 'settings.json'), '{"language":"ja"}');
    writeFileSync(join(root, '.robota', 'settings.json'), '{"language":"ko"}');
    const paths = [{ scope: 'project' as const, relativePath: join('.custom', 'settings.json') }];
    const trusted = await createTrustedProjectAccessFixture(root);
    if (trusted.status !== 'trusted') throw new Error('Expected trusted project access.');

    const trustedResult = await loadInteractiveProjectConfig(undefined, trusted, paths);
    expect(trustedResult.config.language).toBe('ja');

    const restricted = createRestrictedWorkspaceProjectAccess('identity-unavailable', root);
    const restrictedResult = await loadInteractiveProjectConfig(undefined, restricted, paths);
    expect(restrictedResult.config.language).not.toBe('ja');
    expect(restrictedResult.config.language).not.toBe('ko');
  });
});
