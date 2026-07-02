import { describe, expect, it } from 'vitest';

import { extractBlocks } from '../check-doc-examples.mjs';

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
