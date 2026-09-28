import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runQuickstart } from './readme-example';

const here = dirname(fileURLToPath(import.meta.url));

describe('README quickstart example', () => {
  it('runs end to end and publishes the assistant reply', async () => {
    const { result, messages } = await runQuickstart();
    expect(result.status === 'limited' || result.status === 'completed').toBe(true);
    expect(messages).toHaveLength(1);
    // The sole participant's first turn has no purpose and no shared messages, so the rendered
    // increment is the neutral "no new messages" notice rather than an empty string.
    expect(messages[0]).toMatchObject({
      participantId: 'assistant',
      content:
        'echo: There are no new messages since your last turn. Continue or respond as you see fit.',
    });
  });

  it('matches the fenced code block in README.md, so the doc never drifts from what runs', () => {
    const readme = readFileSync(join(here, '..', 'README.md'), 'utf8');
    const source = readFileSync(join(here, 'readme-example.ts'), 'utf8');
    const fenceMatch = readme.match(/```typescript\n([\s\S]*?)\n```/);
    expect(fenceMatch, 'README.md must contain a ```typescript quickstart block').not.toBeNull();
    const fenced = fenceMatch![1];
    // The README fence imports from the published package name; the source file imports from
    // this package's own entry module by relative path. Everything else must match verbatim.
    const asPublished = source.replace(
      "from './index'",
      "from '@robota-sdk/agent-roundtable-robota'",
    );
    expect(fenced.trim()).toBe(asPublished.trim());
  });
});
