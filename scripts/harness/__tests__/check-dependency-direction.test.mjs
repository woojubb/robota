import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkDagNodesLeaf, findWorkspacePackages } from '../check-dependency-direction.mjs';
import { findSdkReactViolations } from '../check-sdk-react-free.mjs';

// Synthetic package map: checkDagNodesLeaf reads only `name` + `pkg.dependencies` (string[]).
function pkgMap(entries) {
  return new Map(entries.map(([name, dependencies]) => [name, { dependencies }]));
}

describe('checkDagNodesLeaf (HARNESS-016 / ARL-16b)', () => {
  it('TC-01: a dag-node-* depending on a sibling dag-node-* is a violation', () => {
    const v = checkDagNodesLeaf(
      pkgMap([['@robota-sdk/dag-node-foo', ['@robota-sdk/dag-core', '@robota-sdk/dag-node-bar']]]),
    );
    expect(v).toHaveLength(1);
    expect(v[0].dep).toBe('@robota-sdk/dag-node-bar');
  });

  it('TC-02: a dag-node-* depending on an orchestrator/runtime layer is a violation', () => {
    const v = checkDagNodesLeaf(
      pkgMap([
        ['@robota-sdk/dag-node-foo', ['@robota-sdk/dag-core', '@robota-sdk/dag-runtime']],
        ['@robota-sdk/dag-node-baz', ['@robota-sdk/dag-node', '@robota-sdk/dag-framework']],
      ]),
    );
    expect(v.map((x) => x.dep).sort()).toEqual([
      '@robota-sdk/dag-framework',
      '@robota-sdk/dag-runtime',
    ]);
  });

  it('allows the node-contract owners and non-dag deps', () => {
    const v = checkDagNodesLeaf(
      pkgMap([
        [
          '@robota-sdk/dag-node-foo',
          ['@robota-sdk/dag-core', '@robota-sdk/dag-node', '@robota-sdk/agent-core', 'zod'],
        ],
      ]),
    );
    expect(v).toEqual([]);
  });

  it('honors the frozen allowlist for the router aggregator (ARL-11 exception)', () => {
    const v = checkDagNodesLeaf(
      pkgMap([
        [
          '@robota-sdk/dag-node-llm-text-router',
          ['@robota-sdk/dag-core', '@robota-sdk/dag-node', '@robota-sdk/dag-node-llm-text-openai'],
        ],
      ]),
    );
    expect(v).toEqual([]);
  });

  it('TC-03: the live repo has no un-allowlisted leaf violations (exit 0)', () => {
    expect(checkDagNodesLeaf(findWorkspacePackages())).toEqual([]);
  });
});

describe('findSdkReactViolations (HARNESS-016 / ARL-16g)', () => {
  it('TC-04: flags a React import + a React dependency in the scanned package', () => {
    const root = mkdtempSync(join(tmpdir(), 'robota-sdk-react-free-'));
    const src = join(root, 'packages', 'agent-framework', 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'x.ts'), `import { useState } from 'react';\nexport const a = 1;\n`);
    writeFileSync(
      join(root, 'packages', 'agent-framework', 'package.json'),
      JSON.stringify({ name: '@robota-sdk/agent-framework', dependencies: { react: '^18' } }),
    );

    const v = findSdkReactViolations(root);
    expect(v.map((x) => x.type).sort()).toEqual(['REACT-DEP', 'REACT-IMPORT']);
  });

  it('flags a missing scan target instead of silently passing (dead-guard guard)', () => {
    const root = mkdtempSync(join(tmpdir(), 'robota-sdk-react-free-missing-'));
    const v = findSdkReactViolations(root, 'agent-sdk'); // husk name — no src/, no package.json
    expect(v.every((x) => x.type === 'SCAN-TARGET-MISSING')).toBe(true);
    expect(v.length).toBe(2);
  });

  it('TC-04(live): the real agent-framework package is React-free (exit 0)', () => {
    expect(findSdkReactViolations()).toEqual([]);
  });
});
