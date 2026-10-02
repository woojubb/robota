import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createNodeWorkspaceIdentityResolver, inspectPreTrustProjectPaths } from './index.js';

const roots: string[] = [];

function temporaryDirectory(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-pretrust-paths-')));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('pre-trust project contribution inspection', () => {
  it('reports path kinds without following a leaf link or a linked ancestor', () => {
    const project = temporaryDirectory();
    const outside = temporaryDirectory();
    execFileSync('git', ['init', '--quiet', project]);
    mkdirSync(join(project, '.agent'), { recursive: true });
    writeFileSync(join(project, '.agent', 'settings.json'), '{ private content');
    mkdirSync(join(outside, 'agents'), { recursive: true });
    symlinkSync(join(outside, 'agents'), join(project, '.agents'));
    symlinkSync(join(outside, 'agents'), join(project, '.agent', 'plugins'));
    const identity = createNodeWorkspaceIdentityResolver().resolve(project);

    expect(
      inspectPreTrustProjectPaths(identity, [
        '.agent/settings.json',
        '.agent/skills',
        '.agent/plugins',
        '.agents/agents',
      ]),
    ).toEqual([
      {
        relativePath: '.agent/settings.json',
        kind: process.platform === 'linux' ? 'file' : 'unavailable',
      },
      {
        relativePath: '.agent/skills',
        kind: process.platform === 'linux' ? 'absent' : 'unavailable',
      },
      {
        relativePath: '.agent/plugins',
        kind: process.platform === 'linux' ? 'link' : 'unavailable',
      },
      { relativePath: '.agents/agents', kind: 'unavailable' },
    ]);
  });

  it('refuses metadata claims for a stale or forged workspace identity', () => {
    const project = temporaryDirectory();
    execFileSync('git', ['init', '--quiet', project]);
    const identity = createNodeWorkspaceIdentityResolver().resolve(project);

    expect(
      inspectPreTrustProjectPaths({ ...identity, repositoryKey: 'different-repository' }, [
        '.agent/settings.json',
      ]),
    ).toEqual([{ relativePath: '.agent/settings.json', kind: 'unavailable' }]);
  });

  it('does not inspect project path metadata on platforms without a stable no-follow walk', () => {
    const project = temporaryDirectory();
    execFileSync('git', ['init', '--quiet', project]);
    writeFileSync(join(project, 'package.json'), '{}');
    const identity = createNodeWorkspaceIdentityResolver().resolve(project);
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...original, value: 'darwin' });
    try {
      expect(inspectPreTrustProjectPaths(identity, ['package.json'])).toEqual([
        { relativePath: 'package.json', kind: 'unavailable' },
      ]);
    } finally {
      Object.defineProperty(process, 'platform', original);
    }
  });
});
