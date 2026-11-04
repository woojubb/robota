import { describe, expect, it } from 'vitest';

import { isDeveloperDocument } from '../ci.mjs';

describe('CI developer-document scope', () => {
  it('does not skip ARCHITECTURE.md, because pnpm lint checks the manifests against its lists', () => {
    expect(isDeveloperDocument('ARCHITECTURE.md')).toBe(false);
  });

  it.each(['README.md', 'AGENTS.md', '.changeset/x.md', 'packages/agent-core/docs/SPEC.md'])(
    'still skips the developer document %s',
    (file) => {
      expect(isDeveloperDocument(file)).toBe(true);
    },
  );
});
