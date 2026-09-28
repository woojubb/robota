import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runQuickstart } from './readme-example';

const here = dirname(fileURLToPath(import.meta.url));

describe('README quickstart example', () => {
  it('waits for the user, then publishes the echo reply and hits the per-run turn limit', async () => {
    const { result, messages, published } = await runQuickstart();
    expect(result).toMatchObject({ status: 'limited', reason: 'turns' });
    expect(messages).toEqual(['Hello', 'echo: Hello']);
    expect(published).toEqual(['echo: echo: Hello']);
  });

  it('matches the fenced code block in README.md, so the doc never drifts from what runs', () => {
    const readme = readFileSync(join(here, '..', 'README.md'), 'utf8');
    const source = readFileSync(join(here, 'readme-example.ts'), 'utf8');
    const fenceMatch = readme.match(/```typescript\n([\s\S]*?)\n```/);
    expect(fenceMatch, 'README.md must contain a ```typescript quickstart block').not.toBeNull();
    const fenced = fenceMatch![1];
    // The README fence imports from the published package name; the source file imports from
    // this package's own entry module by relative path. Everything else must match verbatim.
    const asPublished = source.replace("from './index'", "from '@robota-sdk/agent-roundtable'");
    expect(fenced.trim()).toBe(asPublished.trim());
  });
});
