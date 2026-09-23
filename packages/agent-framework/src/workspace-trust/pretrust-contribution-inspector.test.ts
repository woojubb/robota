import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createNodeWorkspaceIdentityResolver,
  inspectPreTrustProjectPaths,
} from './index.js';

const roots: string[] = [];

function temporaryDirectory(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-pretrust-paths-')));
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
    mkdirSync(join(project, '.robota'), { recursive: true });
    writeFileSync(join(project, '.robota', 'settings.json'), '{ private content');
    mkdirSync(join(outside, 'agents'), { recursive: true });
    symlinkSync(join(outside, 'agents'), join(project, '.agents'));
    symlinkSync(join(outside, 'agents'), join(project, '.robota', 'plugins'));
    const identity = createNodeWorkspaceIdentityResolver().resolve(project);

    expect(
      inspectPreTrustProjectPaths(identity, [
        '.robota/settings.json',
        '.robota/skills',
        '.robota/plugins',
        '.agents/agents',
      ]),
    ).toEqual([
      { relativePath: '.robota/settings.json', kind: 'file' },
      { relativePath: '.robota/skills', kind: 'absent' },
      { relativePath: '.robota/plugins', kind: 'link' },
      { relativePath: '.agents/agents', kind: 'unavailable' },
    ]);
  });

  it('refuses metadata claims for a stale or forged workspace identity', () => {
    const project = temporaryDirectory();
    execFileSync('git', ['init', '--quiet', project]);
    const identity = createNodeWorkspaceIdentityResolver().resolve(project);

    expect(
      inspectPreTrustProjectPaths(
        { ...identity, repositoryKey: 'different-repository' },
        ['.robota/settings.json'],
      ),
    ).toEqual([{ relativePath: '.robota/settings.json', kind: 'unavailable' }]);
  });
});
