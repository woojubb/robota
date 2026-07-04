import { describe, expect, it } from 'vitest';

import { checkInterfacePackageDeps } from '../check-dependency-direction.mjs';
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
