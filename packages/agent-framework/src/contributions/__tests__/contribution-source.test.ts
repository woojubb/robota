import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs';
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
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'arch-042-contribution-')));
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

  it('does not follow final or ancestor links outside an explicit host root', () => {
    const hostRoot = scratchDirectory();
    const outsideRoot = scratchDirectory();
    mkdirSync(join(outsideRoot, 'nested'));
    writeFileSync(join(outsideRoot, 'secret.md'), 'outside secret');
    writeFileSync(join(outsideRoot, 'nested', 'secret.md'), 'nested outside secret');
    symlinkSync(join(outsideRoot, 'secret.md'), join(hostRoot, 'linked-file.md'));
    symlinkSync(join(outsideRoot, 'nested'), join(hostRoot, 'linked-directory'));
    const host = createNodeHostContributionSource(hostRoot);

    expect(host.inspectKind('linked-file.md', 'inspect host link')).toBe('link');
    expect(() => host.readText('linked-file.md', 'read host link')).toThrow(/links/i);
    expect(() => host.readText('linked-directory/secret.md', 'read through host link')).toThrow(
      /links/i,
    );
    expect(() => host.listDirectory('linked-directory', 'list host link')).toThrow(/links/i);
  });

  it('allows an explicit host root to appear after source composition', () => {
    const hostRoot = join(scratchDirectory(), 'not-created-yet');
    const host = createNodeHostContributionSource(hostRoot);

    expect(host.readText('late.md', 'read absent host root')).toBeUndefined();
    expect(host.listDirectory('', 'list absent host root')).toEqual([]);
    mkdirSync(hostRoot);
    writeFileSync(join(hostRoot, 'late.md'), 'late content');
    expect(host.readText('late.md', 'read late host content')).toBe('late content');
  });

  it('rejects an empty explicit host root instead of deriving process cwd authority', () => {
    expect(() => createNodeHostContributionSource('')).toThrow(/root/i);
    expect(() => createNodeHostContributionSource('   ')).toThrow(/root/i);
  });
});
