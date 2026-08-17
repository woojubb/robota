import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findSdkPublicSurfaceFindings } from '../check-sdk-public-surface.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-sdk-public-surface-'));
  const fixtureFiles = {
    'packages/agent-framework/package.json': JSON.stringify({
      exports: {
        '.': { source: './src/index.ts' },
        './testing': { source: './src/testing/index.ts' },
      },
    }),
    'packages/agent-framework/src/testing/index.ts': '',
    ...files,
  };
  for (const [relativePath, content] of Object.entries(fixtureFiles)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

describe('findSdkPublicSurfaceFindings', () => {
  it('flags export-star barrels in agent-sdk source', async () => {
    const root = await createFixture({
      'packages/agent-framework/src/index.ts': "export * from './interactive/index.js';\n",
      'packages/agent-framework/src/interactive/index.ts': '',
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-framework/src/index.ts',
        type: 'sdk-public-export-star',
        detail:
          'agent-framework public barrels must use explicit named exports so owner boundaries are auditable.',
      },
    ]);
  });

  it('flags top-level pass-through exports from lower owner packages', async () => {
    const root = await createFixture({
      'packages/agent-framework/src/index.ts': `
export type {
  IHistoryEntry,
  TPermissionMode,
} from '@robota-sdk/agent-core';
export { readTool } from '@robota-sdk/agent-tools/builtins';
`,
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-framework/src/index.ts',
        type: 'sdk-public-owner-pass-through',
        detail:
          'Public agent-framework export graph must not pass through @robota-sdk/agent-core; import from the owning package or add an explicit SDK-owned facade.',
      },
      {
        file: 'packages/agent-framework/src/index.ts',
        type: 'sdk-public-owner-pass-through',
        detail:
          'Public agent-framework export graph must not pass through @robota-sdk/agent-tools/builtins; import from the owning package or add an explicit SDK-owned facade.',
      },
    ]);
  });

  it('allows runtime re-exports only from SDK runtime facade barrels', async () => {
    const root = await createFixture({
      'packages/agent-framework/src/background-tasks/index.ts':
        "export { BackgroundTaskManager } from '@robota-sdk/agent-executor';\n",
      'packages/agent-framework/src/index.ts':
        "export { BackgroundTaskManager } from './background-tasks/index.js';\n",
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([]);
  });

  // ARCH-031 pruned `subagents/index.ts` from the facade allowlist: it held type-only executor
  // pass-throughs, so it was never the runtime facade the exception exists for. This case is the
  // floor on that pruning — re-adding the entry turns it red.
  it('does not exempt the subagents barrel, whose symbols are reachable elsewhere', async () => {
    const root = await createFixture({
      'packages/agent-framework/src/subagents/index.ts':
        "export { InProcessSubagentRunner } from '@robota-sdk/agent-executor';\n",
      'packages/agent-framework/src/index.ts':
        "export { InProcessSubagentRunner } from './subagents/index.js';\n",
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-framework/src/subagents/index.ts',
        type: 'sdk-unreachable-elsewhere-location',
        detail:
          'agent-executor public re-exports belong only where a permitted consumer cannot reach the symbol any other way (see SDK_UNREACHABLE_ELSEWHERE_FILES), not in arbitrary SDK files.',
      },
    ]);
  });

  it('flags runtime re-exports outside the exempt files', async () => {
    const root = await createFixture({
      'packages/agent-framework/src/index.ts':
        "export { BackgroundTaskManager } from './runtime.js';\n",
      'packages/agent-framework/src/runtime.ts':
        "export { BackgroundTaskManager } from '@robota-sdk/agent-executor';\n",
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-framework/src/runtime.ts',
        type: 'sdk-unreachable-elsewhere-location',
        detail:
          'agent-executor public re-exports belong only where a permitted consumer cannot reach the symbol any other way (see SDK_UNREACHABLE_ELSEWHERE_FILES), not in arbitrary SDK files.',
      },
    ]);
  });

  it('allows internal imports from lower owner packages', async () => {
    const root = await createFixture({
      'packages/agent-framework/src/assembly/create-session.ts':
        "import { BackgroundTaskManager } from '@robota-sdk/agent-executor';\n",
      'packages/agent-framework/src/index.ts':
        "export { InteractiveSession } from './interactive/index.js';\n",
      'packages/agent-framework/src/interactive/index.ts': '',
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([]);
  });

  it('follows deep local barrels through js, extensionless-file, and directory-index resolution', async () => {
    const root = await createFixture({
      'packages/agent-framework/src/index.ts': "export { owned } from './level-one.js';\n",
      'packages/agent-framework/src/level-one.ts': "export { owned } from './level-two';\n",
      'packages/agent-framework/src/level-two.ts': "export type { owned } from './deep';\n",
      'packages/agent-framework/src/deep/index.ts':
        "export type { IHistoryEntry as owned } from '@robota-sdk/agent-core';\n",
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-framework/src/deep/index.ts',
        type: 'sdk-public-owner-pass-through',
        detail:
          'Public agent-framework export graph must not pass through @robota-sdk/agent-core; import from the owning package or add an explicit SDK-owned facade.',
      },
    ]);
  });

  it('traverses every source root declared by the package exports map', async () => {
    const root = await createFixture({
      'packages/agent-framework/src/index.ts': '',
      'packages/agent-framework/src/testing/index.ts':
        "export { readTool } from '@robota-sdk/agent-tools';\n",
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-framework/src/testing/index.ts',
        type: 'sdk-public-owner-pass-through',
        detail:
          'Public agent-framework export graph must not pass through @robota-sdk/agent-tools; import from the owning package or add an explicit SDK-owned facade.',
      },
    ]);
  });

  it('finds an owner pass-through at depth two', async () => {
    const root = await createFixture({
      'packages/agent-framework/src/index.ts': "export { owned } from './one.js';\n",
      'packages/agent-framework/src/one.ts': "export { owned } from './two.js';\n",
      'packages/agent-framework/src/two.ts':
        "export { readTool as owned } from '@robota-sdk/agent-tools';\n",
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-framework/src/two.ts',
        type: 'sdk-public-owner-pass-through',
        detail:
          'Public agent-framework export graph must not pass through @robota-sdk/agent-tools; import from the owning package or add an explicit SDK-owned facade.',
      },
    ]);
  });

  it('terminates safely when reachable local barrels form a cycle', async () => {
    const root = await createFixture({
      'packages/agent-framework/src/index.ts': "export { a } from './a.js';\n",
      'packages/agent-framework/src/a.ts': "export { b as a } from './b.js';\n",
      'packages/agent-framework/src/b.ts': "export { a as b } from './a.js';\n",
    });

    await expect(findSdkPublicSurfaceFindings(root)).resolves.toEqual([]);
  });

  it('fails closed when a reachable local re-export cannot be resolved', async () => {
    const root = await createFixture({
      'packages/agent-framework/src/index.ts': "export { missing } from './missing.js';\n",
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-framework/src/index.ts',
        type: 'sdk-public-unresolved-local-re-export',
        detail: 'Public local re-export ./missing.js does not resolve to a TypeScript source file.',
      },
    ]);
  });

  it('does not judge owner pass-throughs in unreachable internal barrels', async () => {
    const root = await createFixture({
      'packages/agent-framework/src/index.ts': '',
      'packages/agent-framework/src/internal/unreachable.ts':
        "export { readTool } from '@robota-sdk/agent-tools';\n",
    });

    await expect(findSdkPublicSurfaceFindings(root)).resolves.toEqual([]);
  });

  it('flags a forbidden owner import that is exported in a separate declaration', async () => {
    const root = await createFixture({
      'packages/agent-framework/src/index.ts': "export { owned } from './laundered.js';\n",
      'packages/agent-framework/src/laundered.ts': [
        "import type { IHistoryEntry as ImportedHistory } from '@robota-sdk/agent-core';",
        'export type { ImportedHistory as owned };',
        '',
      ].join('\n'),
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-framework/src/laundered.ts',
        type: 'sdk-public-owner-pass-through',
        detail:
          'Public agent-framework export graph must not pass through @robota-sdk/agent-core; import from the owning package or add an explicit SDK-owned facade.',
      },
    ]);
  });

  it('flags agent-executor subpath re-exports outside the named exempt files', async () => {
    const root = await createFixture({
      'packages/agent-framework/src/index.ts': "export type { RuntimePort } from './runtime.js';\n",
      'packages/agent-framework/src/runtime.ts':
        "export type { RuntimePort } from '@robota-sdk/agent-executor/testing';\n",
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-framework/src/runtime.ts',
        type: 'sdk-unreachable-elsewhere-location',
        detail:
          'agent-executor public re-exports belong only where a permitted consumer cannot reach the symbol any other way (see SDK_UNREACHABLE_ELSEWHERE_FILES), not in arbitrary SDK files.',
      },
    ]);
  });

  it('traverses a local import that a public root exports in a separate declaration', async () => {
    const root = await createFixture({
      'packages/agent-framework/src/index.ts': [
        "import { owned } from './local-barrel.js';",
        'export { owned };',
        '',
      ].join('\n'),
      'packages/agent-framework/src/local-barrel.ts':
        "export { readTool as owned } from '@robota-sdk/agent-tools';\n",
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-framework/src/local-barrel.ts',
        type: 'sdk-public-owner-pass-through',
        detail:
          'Public agent-framework export graph must not pass through @robota-sdk/agent-tools; import from the owning package or add an explicit SDK-owned facade.',
      },
    ]);
  });
});
