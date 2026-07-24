import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkDagNodesLeaf,
  checkEntryPointOnly,
  checkPackagePurity,
  checkWorkspacePackageNames,
  findWorkspacePackages,
} from '../check-dependency-direction.mjs';

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

  it('has an empty allowlist — the router aggregator is gone (ARL-11 resolved by ARCH-PROVIDER-003)', () => {
    // The former node→node fan-out (router → vendor nodes) was collapsed into the single
    // registry-injected dag-node-llm-text, so a node→node edge is no longer allowlisted and now fails.
    const v = checkDagNodesLeaf(
      pkgMap([
        [
          '@robota-sdk/dag-node-some-aggregator',
          ['@robota-sdk/dag-core', '@robota-sdk/dag-node', '@robota-sdk/dag-node-llm-text'],
        ],
      ]),
    );
    expect(v.length).toBe(1);
  });

  it('TC-03: the live repo has no un-allowlisted leaf violations (exit 0)', () => {
    expect(checkDagNodesLeaf(findWorkspacePackages())).toEqual([]);
  });
});

// Rule 10 fixtures — package-purity rule absorbed from the former check-sdk-react-free.mjs
// (HARNESS-DIET-003 merge — coverage preserved; the rule is now config-driven `purity` data).
describe('checkPackagePurity (Rule 10, absorbed from check-sdk-react-free)', () => {
  const REACT_RULE = [
    {
      dir: 'packages/agent-framework',
      forbiddenModules: ['react'],
      reason: 'agent-framework is a platform-neutral assembly layer.',
    },
  ];

  it('TC-04: flags a forbidden import + a forbidden dependency in the scanned package', () => {
    const root = mkdtempSync(join(tmpdir(), 'robota-sdk-react-free-'));
    const src = join(root, 'packages', 'agent-framework', 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'x.ts'), `import { useState } from 'react';\nexport const a = 1;\n`);
    writeFileSync(
      join(root, 'packages', 'agent-framework', 'package.json'),
      JSON.stringify({ name: '@robota-sdk/agent-framework', dependencies: { react: '^18' } }),
    );

    const v = checkPackagePurity(root, REACT_RULE);
    expect(v.map((x) => x.type).sort()).toEqual(['FORBIDDEN-DEP', 'FORBIDDEN-IMPORT']);
  });

  it('flags a missing scan target instead of silently passing (dead-guard guard)', () => {
    const root = mkdtempSync(join(tmpdir(), 'robota-sdk-react-free-missing-'));
    // husk dir — no src/, no package.json
    const v = checkPackagePurity(root, [
      { dir: 'packages/agent-sdk', forbiddenModules: ['react'], reason: 'husk.' },
    ]);
    expect(v.every((x) => x.type === 'SCAN-TARGET-MISSING')).toBe(true);
    expect(v.length).toBe(2);
  });

  it('TC-04(live): the shipped purity config passes on the real tree (exit 0)', () => {
    expect(checkPackagePurity()).toEqual([]);
  });
});

// Rule 9 fixtures — workspace-package-name guard absorbed from the former
// check-architecture-conformance.mjs (HARNESS-DIET-003 merge — coverage preserved).
describe('checkWorkspacePackageNames (Rule 9, absorbed from check-architecture-conformance)', () => {
  const DOC_CONFIG = { files: ['ARCHITECTURE.md'], dirs: ['docs/arch'] };
  const PREFIX = '@robota-sdk/agent-';
  const NAMES = new Set(['@robota-sdk/agent-core']);

  function archFixture(files) {
    const root = mkdtempSync(join(tmpdir(), 'robota-pkg-name-guard-'));
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    return root;
  }

  it('RED: flags a ghost package token in a canonical architecture doc', () => {
    const root = archFixture({
      'ARCHITECTURE.md': 'Uses @robota-sdk/agent-core and @robota-sdk/agent-ghost.\n',
    });
    const v = checkWorkspacePackageNames(root, NAMES, DOC_CONFIG, PREFIX);
    expect(v).toHaveLength(1);
    expect(v[0].token).toBe('@robota-sdk/agent-ghost');
    expect(v[0].file).toBe('ARCHITECTURE.md');
  });

  it('exempts a line carrying the "planned" marker (documented-but-uncreated packages)', () => {
    const root = archFixture({
      'ARCHITECTURE.md': '@robota-sdk/agent-future (planned) will own this.\n',
    });
    expect(checkWorkspacePackageNames(root, NAMES, DOC_CONFIG, PREFIX)).toEqual([]);
  });

  it('covers configured doc DIRS and package SPEC.md files', () => {
    const root = archFixture({
      'docs/arch/map.md': 'Edge to @robota-sdk/agent-phantom-a.\n',
      'packages/foo/docs/SPEC.md': 'Depends on @robota-sdk/agent-phantom-b.\n',
    });
    const v = checkWorkspacePackageNames(root, NAMES, DOC_CONFIG, PREFIX);
    expect(v.map((x) => x.token).sort()).toEqual([
      '@robota-sdk/agent-phantom-a',
      '@robota-sdk/agent-phantom-b',
    ]);
  });

  it('GREEN: real workspace package references pass', () => {
    const root = archFixture({
      'ARCHITECTURE.md': 'The foundation is @robota-sdk/agent-core.\n',
    });
    expect(checkWorkspacePackageNames(root, NAMES, DOC_CONFIG, PREFIX)).toEqual([]);
  });

  it('live repo: canonical architecture docs reference only real workspace packages (exit 0)', () => {
    const packages = findWorkspacePackages();
    // Live run uses the shipped harness.config.json architectureDocs + real workspace names.
    const repoRoot = join(import.meta.dirname, '../../..');
    expect(checkWorkspacePackageNames(repoRoot, new Set(packages.keys()))).toEqual([]);
  });
});

// Rule 8 fixtures moved verbatim from the absorbed check-entry-point-only.test.mjs
// (HARNESS-DIET-003 merge — coverage preserved).
const EPO_ROOT = '/repo';

function sourcePkg(name, dir, files) {
  return {
    dir: `${EPO_ROOT}/${dir}`,
    name,
    files: Object.entries(files).map(([path, text]) => ({ path, text })),
  };
}

describe('checkEntryPointOnly (ARCH-PROVIDER-004, absorbed from check-entry-point-only)', () => {
  it('flags a non-sanctioned mid-layer package that STATICALLY imports the aggregator', () => {
    const v = checkEntryPointOnly([
      sourcePkg('@robota-sdk/dag-framework', 'packages/dag-framework', {
        'src/x.ts':
          "import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';",
      }),
    ]);
    expect(v.length).toBe(1);
    expect(v[0].package).toBe('@robota-sdk/dag-framework');
    expect(v[0].aggregator).toBe('@robota-sdk/dag-nodes-default');
  });

  it('does NOT flag a DYNAMIC import (the sanctioned framework seam)', () => {
    const v = checkEntryPointOnly([
      sourcePkg('@robota-sdk/dag-framework', 'packages/dag-framework', {
        'src/x.ts': "const m = await import('@robota-sdk/dag-nodes-default');",
      }),
    ]);
    expect(v).toEqual([]);
  });

  it('does NOT flag sanctioned composition roots', () => {
    const v = checkEntryPointOnly([
      sourcePkg('@robota-sdk/dag-cli', 'packages/dag-cli', {
        'src/r.ts':
          "import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';",
      }),
      sourcePkg('@robota-sdk/agent-command-workflows', 'packages/agent-command-workflows', {
        'src/c.ts':
          "import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';",
      }),
    ]);
    expect(v).toEqual([]);
  });

  it('does NOT flag apps (always entry points)', () => {
    const v = checkEntryPointOnly([
      sourcePkg('@robota-sdk/dag-runtime-server', 'apps/dag-runtime-server', {
        'src/server.ts':
          "import { createDefaultNodeRegistry } from '@robota-sdk/dag-nodes-default';",
      }),
    ]);
    expect(v).toEqual([]);
  });

  it('excludes the aggregator package itself', () => {
    const v = checkEntryPointOnly([
      sourcePkg('@robota-sdk/dag-nodes-default', 'packages/dag-nodes-default', {
        'src/index.ts': "export { x } from '@robota-sdk/dag-nodes-default';",
      }),
    ]);
    expect(v).toEqual([]);
  });
});
