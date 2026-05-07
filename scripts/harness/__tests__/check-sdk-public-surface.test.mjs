import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findSdkPublicSurfaceFindings } from '../check-sdk-public-surface.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-sdk-public-surface-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

describe('findSdkPublicSurfaceFindings', () => {
  it('flags export-star barrels in agent-sdk source', async () => {
    const root = await createFixture({
      'packages/agent-sdk/src/index.ts': "export * from './interactive/index.js';\n",
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-sdk/src/index.ts',
        type: 'sdk-public-export-star',
        detail:
          'agent-sdk public barrels must use explicit named exports so owner boundaries are auditable.',
      },
    ]);
  });

  it('flags top-level pass-through exports from lower owner packages', async () => {
    const root = await createFixture({
      'packages/agent-sdk/src/index.ts': `
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
        file: 'packages/agent-sdk/src/index.ts',
        type: 'sdk-top-level-owner-pass-through',
        detail:
          'Top-level agent-sdk must not pass through @robota-sdk/agent-core; import from the owning package or add an explicit SDK-owned facade.',
      },
      {
        file: 'packages/agent-sdk/src/index.ts',
        type: 'sdk-top-level-owner-pass-through',
        detail:
          'Top-level agent-sdk must not pass through @robota-sdk/agent-tools/builtins; import from the owning package or add an explicit SDK-owned facade.',
      },
    ]);
  });

  it('allows runtime re-exports only from SDK runtime facade barrels', async () => {
    const root = await createFixture({
      'packages/agent-sdk/src/background-tasks/index.ts':
        "export { BackgroundTaskManager } from '@robota-sdk/agent-runtime';\n",
      'packages/agent-sdk/src/subagents/index.ts':
        "export type { ISubagentRunner } from '@robota-sdk/agent-runtime';\n",
      'packages/agent-sdk/src/index.ts':
        "export { BackgroundTaskManager } from './background-tasks/index.js';\n",
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([]);
  });

  it('flags runtime re-exports outside SDK runtime facade barrels', async () => {
    const root = await createFixture({
      'packages/agent-sdk/src/runtime.ts':
        "export { BackgroundTaskManager } from '@robota-sdk/agent-runtime';\n",
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-sdk/src/runtime.ts',
        type: 'sdk-runtime-facade-location',
        detail:
          'agent-runtime public re-exports must stay in SDK runtime facade barrels, not arbitrary SDK files.',
      },
    ]);
  });

  it('allows internal imports from lower owner packages', async () => {
    const root = await createFixture({
      'packages/agent-sdk/src/assembly/create-session.ts':
        "import { BackgroundTaskManager } from '@robota-sdk/agent-runtime';\n",
      'packages/agent-sdk/src/index.ts':
        "export { InteractiveSession } from './interactive/index.js';\n",
    });

    const findings = await findSdkPublicSurfaceFindings(root);

    expect(findings).toEqual([]);
  });
});
