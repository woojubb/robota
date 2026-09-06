import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverAdditionalScans } from '../discovery-loader.mjs';
import { makeTemp } from './make-temp.mjs';

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot() {
  const root = makeTemp('robota-scan-discovery-');
  mkdirSync(path.join(root, 'scripts', 'harness'), { recursive: true });
  temporaryRoots.push(root);
  return root;
}

describe('scan discovery', () => {
  it('treats an absent optional harness directory as having no additional scans', async () => {
    const root = makeTemp('robota-scan-discovery-empty-');
    temporaryRoots.push(root);

    await expect(discoverAdditionalScans({ root })).resolves.toEqual([]);
  });

  it('loads a self-declared scan without a runner edit', async () => {
    const root = fixtureRoot();
    writeFileSync(
      path.join(root, 'scripts', 'harness', 'scan-fixture.mjs'),
      "export const scanDefinition = { name: 'fixture', examines: ['fixtures/**'], advisory: true };\n",
    );

    await expect(discoverAdditionalScans({ root })).resolves.toEqual([
      {
        name: 'fixture',
        examines: ['fixtures/**'],
        advisory: true,
        command: ['node', 'scripts/harness/scan-fixture.mjs'],
      },
    ]);
  });

  it('refuses a candidate that has no declaration', async () => {
    const root = fixtureRoot();
    writeFileSync(path.join(root, 'scripts', 'harness', 'scan-undecided.mjs'), 'export {};\n');

    await expect(discoverAdditionalScans({ root })).rejects.toThrow(
      'without scanDefinition; declare what it reads',
    );
  });
});
