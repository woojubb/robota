import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createNodeHostContributionSource,
  createWorkspaceProjectContributionSource,
} from '../index.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { getWorkspaceProjectReader } from '../../workspace-trust/index.js';

describe('contribution sources', () => {
  const scratchDirectories: string[] = [];

  function scratchDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), 'arch-042-contribution-'));
    scratchDirectories.push(directory);
    return directory;
  }

  afterEach(() => {
    for (const directory of scratchDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps explicitly named host content distinct from authority-backed project content', async () => {
    const hostRoot = scratchDirectory();
    const projectRoot = scratchDirectory();
    mkdirSync(join(hostRoot, 'docs'));
    mkdirSync(join(projectRoot, 'docs'));
    writeFileSync(join(hostRoot, 'docs', 'source.md'), 'host');
    writeFileSync(join(projectRoot, 'docs', 'source.md'), 'project');

    const access = await createTrustedProjectAccessFixture(projectRoot);
    if (access.status !== 'trusted') throw new Error('Expected trusted fixture access.');
    const host = createNodeHostContributionSource(hostRoot);
    const project = createWorkspaceProjectContributionSource(
      getWorkspaceProjectReader(access.authority),
    );

    expect(host.kind).toBe('host');
    expect(host.readText('docs/source.md', 'test host content')).toBe('host');
    expect(project.kind).toBe('project');
    expect(project.readText('docs/source.md', 'test project content')).toBe('project');
    expect(() => project.readText('../source.md', 'test escape')).toThrowError(/Project reads/);
  });
});
