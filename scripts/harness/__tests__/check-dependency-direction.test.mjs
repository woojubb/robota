import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { familyOf, readFamilySiblingBaseline } from '../family-siblings.mjs';
import {
  checkDagNodesLeaf,
  checkEntryPointOnly,
  checkFamilySiblings,
  checkPackagePurity,
  checkUndeclaredImports,
  checkWorkspacePackageNames,
  findWorkspacePackages,
  loadSourcePackages,
  readExaminedFamilyMembers,
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
    const root = makeTemp('robota-sdk-react-free-');
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
    const root = makeTemp('robota-sdk-react-free-missing-');
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
    const root = makeTemp('robota-pkg-name-guard-');
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

// Rule 11 / 12 fixtures — FAMILY-SIBLINGS and UNDECLARED-IMPORT (STRUCT-012).
const S = '@robota-sdk/';
const fam = (entries) => pkgMap(entries.map(([n, d]) => [S + n, d.map((x) => S + x)]));
const EMPTY = { baseline: new Map() };

describe('checkFamilySiblings (STRUCT-012 / FAMILY-SIBLINGS)', () => {
  it('familyOf: the family is the second dash segment; a bare parent declares none', () => {
    expect(familyOf(`${S}agent-transport-webrtc-web`)).toBe(`${S}agent-transport`);
    expect(familyOf(`${S}agent-transport`)).toBeNull();
    expect(familyOf(`${S}agent-tools`)).toBeNull();
    expect(familyOf('zod')).toBeNull();
  });

  it('TC-01: exactly the sibling edges are reported; parent edges and child → agent-framework are not', () => {
    const fixture = fam([
      ['agent-transport', ['agent-interface-transport']],
      ['agent-transport-ws', ['agent-transport', 'agent-interface-transport', 'agent-framework']],
      ['agent-transport-webrtc', ['agent-transport', 'agent-transport-ws']],
      ['agent-session', ['agent-core']],
      ['agent-session-analytics', ['agent-session']],
      ['agent-session-replay', ['agent-session-analytics']],
      ['agent-ui-web', ['agent-interface-transport', 'agent-transport']],
      ['agent-ui-terminal', ['agent-ui-web', 'agent-framework']],
    ]);
    const { violations, examined } = checkFamilySiblings(fixture, EMPTY);
    expect(violations.map((v) => `${v.package} -> ${v.dep}`).sort()).toEqual([
      `${S}agent-session-replay -> ${S}agent-session-analytics`,
      `${S}agent-transport-webrtc -> ${S}agent-transport-ws`,
      `${S}agent-ui-terminal -> ${S}agent-ui-web`,
    ]);
    expect(examined).toBe(6);
  });

  it('reports the size of what it examined, reset per run', () => {
    const six = fam([
      ['agent-transport-ws', ['agent-transport']],
      ['agent-transport-http', ['agent-transport']],
      ['agent-session-analytics', ['agent-session']],
      ['agent-session-replay', ['agent-session']],
      ['agent-ui-web', ['agent-transport']],
      ['agent-ui-terminal', ['agent-framework']],
    ]);
    const two = fam([
      ['agent-transport-ws', ['agent-transport']],
      ['agent-transport-http', ['agent-transport']],
    ]);
    checkFamilySiblings(six, EMPTY);
    expect(readExaminedFamilyMembers(six)).toBe(6);
    checkFamilySiblings(two, EMPTY);
    expect(readExaminedFamilyMembers(two)).toBe(2);
  });

  it('TC-01: a family resolving to zero members is a finding, not a pass', () => {
    const { violations, examined } = checkFamilySiblings(fam([['agent-core', []]]), EMPTY);
    expect(examined).toBe(0);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toMatch(/zero family members/);
  });

  it('delegates the agent-interface family to INTERFACE-DEPS (judged once)', () => {
    const { violations } = checkFamilySiblings(
      fam([['agent-interface-session', ['agent-interface-command']]]),
      EMPTY,
    );
    expect(violations).toEqual([]);
  });

  it('TC-11: a parent depending on a child, and the composer/foundation depending on a transport or UI child, are reported', () => {
    const { violations } = checkFamilySiblings(
      fam([
        ['agent-transport', ['agent-transport-ws']],
        ['agent-transport-ws', ['agent-transport']],
        ['agent-framework', ['agent-transport-ws']],
        ['agent-core', ['agent-ui-web']],
      ]),
      EMPTY,
    );
    expect(violations.map((v) => `${v.package} -> ${v.dep}`).sort()).toEqual([
      `${S}agent-core -> ${S}agent-ui-web`,
      `${S}agent-framework -> ${S}agent-transport-ws`,
      `${S}agent-transport -> ${S}agent-transport-ws`,
    ]);
  });

  it('judges peerDependencies with dependencies, never devDependencies', () => {
    const packages = new Map([
      [
        `${S}agent-transport-ws`,
        { dependencies: [], peerDependencies: [`${S}agent-transport-http`] },
      ],
      [
        `${S}agent-transport-http`,
        { dependencies: [], allDependencies: [`${S}agent-transport-ws`] },
      ],
    ]);
    const { violations } = checkFamilySiblings(packages, EMPTY);
    expect(violations.map((v) => v.dep)).toEqual([`${S}agent-transport-http`]);
  });

  it('TC-02: the live tree is green against the frozen baseline, and deleting any one entry reports that edge', () => {
    const packages = findWorkspacePackages();
    const baseline = readFamilySiblingBaseline();
    expect(baseline.size).toBeGreaterThan(0);
    expect(checkFamilySiblings(packages, { baseline }).violations).toEqual([]);
    for (const edge of baseline.keys()) {
      const shrunk = new Map(baseline);
      shrunk.delete(edge);
      const { violations } = checkFamilySiblings(packages, { baseline: shrunk });
      expect(violations.map((v) => `${v.package} -> ${v.dep}`)).toEqual([edge]);
    }
  });

  it('TC-03: a baseline entry whose edge does not exist in the tree is a stale-entry finding', () => {
    const baseline = new Map(readFamilySiblingBaseline());
    baseline.set(`${S}agent-transport-http -> ${S}agent-transport-ws`, 'never existed');
    const { violations } = checkFamilySiblings(findWorkspacePackages(), { baseline });
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toMatch(/stale baseline entry/);
  });
});

describe('checkUndeclaredImports (STRUCT-012 / UNDECLARED-IMPORT)', () => {
  const packages = new Map([
    [
      `${S}agent-transport-ws`,
      {
        dependencies: [`${S}agent-interface-transport`],
        allDependencies: [`${S}agent-interface-transport`],
      },
    ],
    [`${S}agent-transport`, { dependencies: [], allDependencies: [] }],
    [`${S}agent-transport-http`, { dependencies: [], allDependencies: [`${S}agent-transport`] }],
  ]);
  const src = (name, path, text) => ({ name, dir: name, files: [{ path, text }] });

  it('TC-12: a production import of a workspace package declared in no manifest section is reported', () => {
    const v = checkUndeclaredImports(
      [
        src(
          `${S}agent-transport-ws`,
          'packages/agent-transport-ws/src/x.ts',
          "import { a } from '@robota-sdk/agent-transport';\n",
        ),
      ],
      packages,
    );
    expect(v).toHaveLength(1);
    expect(v[0].dep).toBe(`${S}agent-transport`);
  });

  it('TC-12: a devDependency satisfies the declaration, and a subpath resolves to its package', () => {
    const v = checkUndeclaredImports(
      [
        src(
          `${S}agent-transport-http`,
          'packages/agent-transport-http/src/x.ts',
          "import type { T } from '@robota-sdk/agent-transport/node';\n",
        ),
      ],
      packages,
    );
    expect(v).toEqual([]);
  });

  it('ignores tests, template/JSDoc text, self-imports and non-workspace specifiers', () => {
    const v = checkUndeclaredImports(
      [
        src(
          `${S}agent-transport-ws`,
          'packages/agent-transport-ws/src/__tests__/x.test.ts',
          "import { a } from '@robota-sdk/agent-transport';\n",
        ),
        src(
          `${S}agent-transport-ws`,
          'packages/agent-transport-ws/src/tpl.ts',
          "const t = `\n  import { a } from '@robota-sdk/agent-transport';\n`;\n// import { b } from '@robota-sdk/agent-transport';\nimport { c } from '@robota-sdk/agent-transport-ws';\nimport { d } from '@robota-sdk/agent-provider';\n",
        ),
      ],
      packages,
    );
    // The template-literal line is indented (not at line start) and the comment line is not an import
    // declaration; the self-import and the non-workspace specifier are outside the rule.
    expect(v).toEqual([]);
  });

  it('live: every production workspace import is declared (exit 0)', () => {
    const packages = findWorkspacePackages();
    const sources = loadSourcePackages(packages);
    expect(sources.reduce((n, s) => n + s.files.length, 0)).toBeGreaterThan(100);
    expect(checkUndeclaredImports(sources, packages)).toEqual([]);
  });
});
