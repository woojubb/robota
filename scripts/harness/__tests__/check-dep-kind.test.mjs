import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findDevDepOnlyRuntimeImports } from '../check-dep-kind.mjs';

async function createFixture(packages) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-dep-kind-'));
  for (const pkg of packages) {
    const pkgDir = path.join(root, 'packages', pkg.dir);
    mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(pkg.manifest, null, 2));
    for (const [relative, content] of Object.entries(pkg.files ?? {})) {
      const target = path.join(pkgDir, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
  }
  return root;
}

describe('findDevDepOnlyRuntimeImports (INFRA-024)', () => {
  it('flags a runtime value import declared only in devDependencies', async () => {
    const root = await createFixture([
      {
        dir: 'consumer',
        manifest: {
          name: '@robota-sdk/consumer',
          devDependencies: { '@robota-sdk/agent-executor': 'workspace:*' },
        },
        files: {
          'src/main.ts': "import { createRunners } from '@robota-sdk/agent-executor';\n",
        },
      },
    ]);

    const { findings } = await findDevDepOnlyRuntimeImports(root);
    expect(findings).toEqual([
      {
        package: '@robota-sdk/consumer',
        module: '@robota-sdk/agent-executor',
        file: path.join('packages', 'consumer', 'src', 'main.ts'),
      },
    ]);
  });

  it('allows type-only imports and peerDependencies value imports', async () => {
    const root = await createFixture([
      {
        dir: 'typed',
        manifest: {
          name: '@robota-sdk/typed',
          devDependencies: { '@robota-sdk/agent-executor': 'workspace:*' },
        },
        files: {
          'src/types.ts': "import type { IRunner } from '@robota-sdk/agent-executor';\n",
        },
      },
      {
        dir: 'peered',
        manifest: {
          name: '@robota-sdk/peered',
          peerDependencies: { '@robota-sdk/agent-core': 'workspace:*' },
          devDependencies: { '@robota-sdk/agent-core': 'workspace:*' },
        },
        files: {
          'src/tool.ts': "import { AbstractTool } from '@robota-sdk/agent-core';\n",
        },
      },
    ]);

    const { findings } = await findDevDepOnlyRuntimeImports(root);
    expect(findings).toEqual([]);
  });

  it('ignores JSDoc examples, generated-code strings, and test surfaces', async () => {
    const root = await createFixture([
      {
        dir: 'clean',
        manifest: {
          name: '@robota-sdk/clean',
          devDependencies: { '@robota-sdk/agent-provider': 'workspace:*' },
        },
        files: {
          'src/doc.ts': [
            '/**',
            " * import { OpenAIProvider } from '@robota-sdk/agent-provider';",
            ' */',
            'export const codegen = [',
            "  `import { X } from '@robota-sdk/agent-provider';`,",
            '];',
            '',
          ].join('\n'),
          'src/__tests__/probe.test.ts':
            "import { OpenAIProvider } from '@robota-sdk/agent-provider';\n",
          'src/testing/harness.ts':
            "import { OpenAIProvider } from '@robota-sdk/agent-provider';\n",
        },
      },
    ]);

    const { findings } = await findDevDepOnlyRuntimeImports(root);
    expect(findings).toEqual([]);
  });

  it('leaves entirely-undeclared imports to the deps scan (no double reporting)', async () => {
    const root = await createFixture([
      {
        dir: 'undeclared',
        manifest: { name: '@robota-sdk/undeclared' },
        files: {
          'src/main.ts': "import { x } from '@robota-sdk/agent-tools';\n",
        },
      },
    ]);

    const { findings } = await findDevDepOnlyRuntimeImports(root);
    expect(findings).toEqual([]);
  });
});

describe('HARNESS-022 blind-spot extensions', () => {
  it('flags a SUBPATH value import declared only in devDependencies', async () => {
    const root = await createFixture([
      {
        dir: 'subpath',
        manifest: {
          name: '@robota-sdk/subpath',
          devDependencies: { '@robota-sdk/agent-transport': 'workspace:*' },
        },
        files: {
          'src/main.ts': "import { createHeadless } from '@robota-sdk/agent-transport/headless';\n",
        },
      },
    ]);

    const { findings } = await findDevDepOnlyRuntimeImports(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].module).toBe('@robota-sdk/agent-transport');
  });

  it('flags a runtime export…from re-export against devDeps, but not export type', async () => {
    const root = await createFixture([
      {
        dir: 'reexport',
        manifest: {
          name: '@robota-sdk/reexport',
          devDependencies: { '@robota-sdk/agent-executor': 'workspace:*' },
        },
        files: {
          'src/value.ts': "export { createRunners } from '@robota-sdk/agent-executor';\n",
          'src/types.ts': "export type { IRunner } from '@robota-sdk/agent-executor';\n",
        },
      },
    ]);

    const { findings } = await findDevDepOnlyRuntimeImports(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toContain('value.ts');
  });
});
