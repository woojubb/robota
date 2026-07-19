import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findDisallowedDeps } from '../scan-agent-tools-neutrality.mjs';

/**
 * HARNESS-027 — the agent-tools neutrality floor: no heavy third-party SDK as a runtime dep.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');

describe('findDisallowedDeps', () => {
  it('is clean for the allowlist + @robota-sdk/* workspace edges', () => {
    expect(
      findDisallowedDeps({
        dependencies: {
          '@robota-sdk/agent-process': 'workspace:*',
          'fast-glob': '^3',
          'p-limit': '^7',
          zod: '^3',
        },
        peerDependencies: { '@robota-sdk/agent-core': 'workspace:*' },
      }),
    ).toEqual([]);
  });

  it('flags a heavy SDK in EACH runtime dep kind (dependencies / peer / optional)', () => {
    expect(findDisallowedDeps({ dependencies: { playwright: '^1' } })).toEqual(['playwright']);
    expect(findDisallowedDeps({ peerDependencies: { 'tree-sitter': '^0.20' } })).toEqual([
      'tree-sitter',
    ]);
    expect(
      findDisallowedDeps({ optionalDependencies: { '@pinecone-database/pinecone': '^2' } }),
    ).toEqual(['@pinecone-database/pinecone']);
  });

  it('does NOT check devDependencies (build/test tooling, not shipped)', () => {
    expect(
      findDisallowedDeps({ devDependencies: { tsdown: '^0', vitest: '^3', playwright: '^1' } }),
    ).toEqual([]);
  });

  it('the LIVE agent-tools package is clean', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, 'packages/agent-tools/package.json'), 'utf8'),
    );
    expect(findDisallowedDeps(pkg)).toEqual([]);
  });
});
