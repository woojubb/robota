import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findCapabilityPlacementFindings } from '../check-capability-placement.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-capability-placement-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

function packageJson(name, extra = {}) {
  return JSON.stringify({
    name,
    version: '0.0.0',
    type: 'module',
    exports: {
      '.': './dist/index.js',
      ...(extra.exports ?? {}),
    },
    dependencies: extra.dependencies ?? {},
  });
}

const projectStructure = [
  'packages/',
  '- agent-cli',
  '- agent-sdk',
  '- agent-command-*',
  '- agent-provider-*',
  '- agent-transport-*',
  'apps/',
  '- agent-web',
  '- apps/docs',
  '- apps/blog',
  '- agent-server',
].join('\n');

describe('findCapabilityPlacementFindings', () => {
  it('flags durable product-shell ownership declarations', async () => {
    const root = await createFixture({
      '.agents/project-structure.md': projectStructure,
      'packages/agent-cli/package.json': packageJson('@robota-sdk/agent-cli'),
      'packages/agent-cli/docs/SPEC.md': '# Agent CLI SPEC\n',
      'packages/agent-cli/src/background/task-registry.ts':
        'export class BackgroundTaskRegistry {}\n',
    });

    const findings = await findCapabilityPlacementFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-cli/src/background/task-registry.ts',
        type: 'product-shell-background-registry',
        detail: 'Product shells must not own durable background task registries.',
      },
    ]);
  });

  it('flags command packages that depend on provider implementations', async () => {
    const root = await createFixture({
      '.agents/project-structure.md': projectStructure,
      'packages/agent-command-agent/package.json': packageJson('@robota-sdk/agent-command-agent', {
        dependencies: {
          '@robota-sdk/agent-provider-openai': 'workspace:*',
        },
      }),
    });

    const findings = await findCapabilityPlacementFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-command-agent/package.json',
        type: 'command-package-forbidden-dependency',
        detail:
          'Command packages must not depend on @robota-sdk/agent-provider-openai; keep command behavior below product shells and separate from provider implementations.',
      },
    ]);
  });

  it('allows documented product-shell composition-root imports from exported owner entries', async () => {
    const root = await createFixture({
      '.agents/project-structure.md': projectStructure,
      'packages/agent-cli/package.json': packageJson('@robota-sdk/agent-cli'),
      'packages/agent-cli/docs/SPEC.md': '# Agent CLI SPEC\n',
      'packages/agent-sdk/package.json': packageJson('@robota-sdk/agent-sdk'),
      'packages/agent-sdk/docs/SPEC.md': '# Agent SDK SPEC\n',
      'packages/agent-cli/src/cli.ts':
        'import { InteractiveSession } from "@robota-sdk/agent-sdk";\n',
    });

    const findings = await findCapabilityPlacementFindings(root);

    expect(findings).toEqual([]);
  });

  it('flags product-shell imports of unexported owner package subpaths', async () => {
    const root = await createFixture({
      '.agents/project-structure.md': projectStructure,
      'packages/agent-cli/package.json': packageJson('@robota-sdk/agent-cli'),
      'packages/agent-cli/docs/SPEC.md': '# Agent CLI SPEC\n',
      'packages/agent-sdk/package.json': packageJson('@robota-sdk/agent-sdk'),
      'packages/agent-sdk/docs/SPEC.md': '# Agent SDK SPEC\n',
      'packages/agent-cli/src/cli.ts': 'import { unsafe } from "@robota-sdk/agent-sdk/internal";\n',
    });

    const findings = await findCapabilityPlacementFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-cli/src/cli.ts',
        type: 'composition-root-import-unexported-subpath',
        detail: '@robota-sdk/agent-sdk/internal is not an exported owner package entry.',
      },
    ]);
  });

  it('flags workspace packages not covered by project-structure rules', async () => {
    const root = await createFixture({
      '.agents/project-structure.md': 'packages/\n- agent-cli\n',
      'apps/new-shell/package.json': packageJson('@robota-sdk/new-shell'),
    });

    const findings = await findCapabilityPlacementFindings(root);

    expect(findings).toEqual([
      {
        file: '.agents/project-structure.md',
        type: 'workspace-package-not-documented',
        detail: 'apps/new-shell is not covered by project-structure package family rules.',
      },
    ]);
  });
});
