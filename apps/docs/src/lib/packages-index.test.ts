import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getAllSlugs } from './content';
import { buildPackageIndex, firstParagraph } from './packages-index';

let packagesDir: string;

function write(rel: string, body: string): void {
  const abs = path.join(packagesDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

beforeAll(() => {
  packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-pkgs-'));
  write('agent-core/package.json', JSON.stringify({ name: '@robota-sdk/agent-core' }));
  write(
    'agent-core/docs/README.md',
    '# Agent Core\n\n`agent-core` owns the [run loop](./SPEC.md) and **provider contracts**.\n\n- SPEC.md\n',
  );
  write('dag-builder/package.json', JSON.stringify({ name: '@robota-sdk/dag-builder', private: true }));
  write('dag-builder/docs/README.md', '# DAG Builder\n\nBuilds DAG definitions.\n');
  write('no-docs/package.json', JSON.stringify({ name: '@robota-sdk/no-docs' }));
  write('node-folder/docs/README.md', '# Nodes\n\nA folder of node packages.\n');
});

afterAll(() => {
  fs.rmSync(packagesDir, { recursive: true, force: true });
});

describe('buildPackageIndex', () => {
  it('lists packages that have docs, with npm name, summary and internal flag', () => {
    expect(buildPackageIndex(packagesDir)).toEqual([
      {
        dir: 'agent-core',
        name: '@robota-sdk/agent-core',
        summary: 'agent-core owns the run loop and provider contracts.',
        internal: false,
      },
      { dir: 'dag-builder', name: '@robota-sdk/dag-builder', summary: 'Builds DAG definitions.', internal: true },
      { dir: 'node-folder', name: 'node-folder', summary: 'A folder of node packages.', internal: true },
    ]);
  });

  it('skips headings, lists and code when picking the summary', () => {
    expect(firstParagraph('# T\n\n- item\n\n```ts\nx\n```\n\nReal text here.\n')).toBe('Real text here.');
  });
});

describe('getAllSlugs', () => {
  it('includes the packages index route that the header and sidebar link to', () => {
    expect(getAllSlugs()).toContainEqual(['packages']);
  });
});
