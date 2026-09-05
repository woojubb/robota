import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { API } from '@typescript/native-preview/unstable/sync';
import { describe, expect, it } from 'vitest';
import { makeTemp } from './make-temp.mjs';

import { buildTsconfig, extractBlocks } from '../check-doc-examples.mjs';

describe('transport node documentation resolver preparation', () => {
  it('resolves a fixture-only node subpath from the generated source mapping', () => {
    const root = makeTemp('robota-doc-node-');
    const snippets = path.join(root, 'snippets');
    const nodeSource = path.join(root, 'packages/agent-transport/src/node/index.ts');
    mkdirSync(path.dirname(nodeSource), { recursive: true });
    mkdirSync(snippets);
    writeFileSync(nodeSource, 'export const marker = 1;\n');
    writeFileSync(
      path.join(snippets, 'sample.ts'),
      "import { marker } from '@robota-sdk/agent-transport/node';\nexport const observed = marker;\n",
    );
    const project = path.join(snippets, 'tsconfig.json');
    writeFileSync(project, JSON.stringify(buildTsconfig(snippets, root)));
    const api = new API({ cwd: root });
    const loaded = api.updateSnapshot({ openProjects: [project] }).getProject(project);
    expect(loaded?.program.getSourceFile(nodeSource)).toBeDefined();
    // Only the fixture provides this future S3 source; this asserts no shipped S2 subpath.
  });
});

describe('extractBlocks', () => {
  it('extracts ts and typescript fenced blocks with indices', () => {
    const md = 'intro\n```ts\nconst a = 1;\n```\ntext\n```typescript\nconst b = 2;\n```\n';
    const blocks = extractBlocks(md);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ index: 0, code: 'const a = 1;\n', skipReason: null });
    expect(blocks[1].code).toBe('const b = 2;\n');
  });

  it('captures the skip marker on the line directly above the fence', () => {
    const md = 'x\n<!-- doc-example-skip: needs optional dep -->\n```ts\nbroken(\n```\n';
    expect(extractBlocks(md)[0].skipReason).toBe('needs optional dep');
  });

  it('honors a skip marker separated from the fence by blank lines (prettier formatting)', () => {
    const md = 'x\n<!-- doc-example-skip: fragment -->\n\n```ts\nbroken(\n```\n';
    expect(extractBlocks(md)[0].skipReason).toBe('fragment');
  });

  it('ignores non-ts fences and markers not adjacent to a fence', () => {
    const md =
      '<!-- doc-example-skip: far away -->\n\nprose\n```bash\nls\n```\n```ts\nconst x = 1;\n```\n';
    const blocks = extractBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].skipReason).toBeNull();
  });
});
