import { describe, expect, it } from 'vitest';

import { checkFullGraphCycles, checkInterfacePackageDeps } from '../check-dependency-direction.mjs';
import { extractFrameworkImports } from '../check-interface-imports.mjs';

describe('checkInterfacePackageDeps (INFRA-025)', () => {
  it('flags an interface package depending on an implementation package', () => {
    const packages = new Map([
      [
        '@robota-sdk/agent-interface-transport',
        {
          name: '@robota-sdk/agent-interface-transport',
          path: '/x',
          dependencies: ['@robota-sdk/agent-core', '@robota-sdk/agent-executor'],
        },
      ],
    ]);

    const violations = checkInterfacePackageDeps(packages);
    expect(violations).toHaveLength(1);
    expect(violations[0].dep).toBe('@robota-sdk/agent-executor');
  });

  it('allows agent-core and external deps', () => {
    const packages = new Map([
      [
        '@robota-sdk/agent-interface-tui',
        {
          name: '@robota-sdk/agent-interface-tui',
          path: '/x',
          dependencies: ['@robota-sdk/agent-core', 'zod'],
        },
      ],
      [
        '@robota-sdk/agent-framework',
        {
          name: '@robota-sdk/agent-framework',
          path: '/x',
          dependencies: ['@robota-sdk/agent-session'],
        },
      ],
    ]);

    expect(checkInterfacePackageDeps(packages)).toEqual([]);
  });
});

describe('extractFrameworkImports export-from detection (INFRA-025 P2 gap)', () => {
  it('catches export … from pass-throughs, not only import statements', () => {
    const source = [
      "export type { IExecutionWorkspaceSnapshot } from '@robota-sdk/agent-framework';",
      "import type { ICommandHostContext } from '@robota-sdk/agent-framework';",
    ].join('\n');

    const found = extractFrameworkImports(source);
    const names = found.flatMap((entry) => entry.names);
    expect(names).toContain('IExecutionWorkspaceSnapshot');
    expect(names).toContain('ICommandHostContext');
  });
});

describe('checkFullGraphCycles (HARNESS-022)', () => {
  it('detects a cycle that only exists through devDependencies', () => {
    const packages = new Map([
      [
        '@robota-sdk/a',
        {
          name: '@robota-sdk/a',
          path: '/x',
          dependencies: ['@robota-sdk/b'],
          allDependencies: ['@robota-sdk/b'],
        },
      ],
      [
        '@robota-sdk/b',
        { name: '@robota-sdk/b', path: '/x', dependencies: [], allDependencies: ['@robota-sdk/a'] },
      ],
    ]);

    const violations = checkFullGraphCycles(packages);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('@robota-sdk/a -> @robota-sdk/b -> @robota-sdk/a');
  });

  it('passes an acyclic full graph', () => {
    const packages = new Map([
      [
        '@robota-sdk/a',
        { name: '@robota-sdk/a', path: '/x', dependencies: [], allDependencies: ['@robota-sdk/b'] },
      ],
      [
        '@robota-sdk/b',
        { name: '@robota-sdk/b', path: '/x', dependencies: [], allDependencies: [] },
      ],
    ]);

    expect(checkFullGraphCycles(packages)).toEqual([]);
  });
});

describe('checkInterfacePackageDeps — peer edges by declared layer (ARCH-101)', () => {
  const layers = new Map([
    ['agent-interface-transport', 0],
    ['agent-interface-command', 0],
    ['agent-interface-execution', 0],
    ['agent-interface-session', 1],
    ['agent-interface-session-mobility', 2],
  ]);
  const pkg = (name, dependencies) => new Map([[name, { name, path: '/x', dependencies }]]);
  const run = (name, deps) => checkInterfacePackageDeps(pkg(name, deps), layers);

  it('ACCEPTS a downward peer edge — the whole point of the amendment', () => {
    expect(
      run('@robota-sdk/agent-interface-session', ['@robota-sdk/agent-interface-execution']),
    ).toEqual([]);
  });

  it('ACCEPTS a downward edge spanning two layers', () => {
    expect(
      run('@robota-sdk/agent-interface-session-mobility', [
        '@robota-sdk/agent-interface-execution',
      ]),
    ).toEqual([]);
  });

  it('REFUSES a same-layer peer edge', () => {
    const v = run('@robota-sdk/agent-interface-command', ['@robota-sdk/agent-interface-execution']);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('SAME-LAYER');
  });

  it('REFUSES an upward peer edge', () => {
    const v = run('@robota-sdk/agent-interface-execution', ['@robota-sdk/agent-interface-session']);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('UPWARD');
  });

  it('REFUSES an undeclared peer rather than treating it as legal by default', () => {
    const v = run('@robota-sdk/agent-interface-session', ['@robota-sdk/agent-interface-nowhere']);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('no declared layer');
  });

  it('still REFUSES an implementation dependency, which layers do not excuse', () => {
    const v = run('@robota-sdk/agent-interface-session', ['@robota-sdk/agent-framework']);
    expect(v).toHaveLength(1);
    expect(v[0].dep).toBe('@robota-sdk/agent-framework');
  });

  it('still allows agent-core', () => {
    expect(run('@robota-sdk/agent-interface-session', ['@robota-sdk/agent-core'])).toEqual([]);
  });
});
