import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { findCapabilityPlacementFindings } from '../check-capability-placement.mjs';

async function createFixture(files) {
  const root = makeTemp('robota-capability-placement-');
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
  '- agent-framework',
  '- agent-sdk',
  '- agent-command-*',
  '- agent-provider-*',
  '- agent-transport-*',
  '- agent-ui-*/',
  'apps/',
  '- agent-web',
  '- apps/docs',
  '- apps/blog',
  '- agent-server',
].join('\n');

describe('findCapabilityPlacementFindings', () => {
  it('accepts the documented TUI owner with local PTY support, without a testing package', async () => {
    const root = await createFixture({
      '.agents/project-structure.md': 'packages/\n- agent-ui-terminal/\n',
      'packages/agent-ui-terminal/package.json': packageJson('@robota-sdk/agent-ui-terminal'),
      'packages/agent-ui-terminal/docs/SPEC.md': '# TUI\nOwns src/__tests__/pty/ support.\n',
      'packages/agent-ui-terminal/src/__tests__/pty/spawn-pty.ts':
        'export function spawnPty() {}\n',
      'packages/agent-ui-terminal/src/__tests__/pty/isolated-home.ts':
        'export function createIsolatedHome() {}\n',
      'packages/agent-ui-terminal/src/__tests__/pty/pty-driver.ts':
        'import { spawnPty } from "./spawn-pty";\n',
    });

    expect(await findCapabilityPlacementFindings(root)).toEqual([]);
  });

  it('still requires documentation for the TUI owner of local PTY support', async () => {
    const root = await createFixture({
      '.agents/project-structure.md': 'packages/\n- agent-cli/\n',
      'packages/agent-ui-terminal/package.json': packageJson('@robota-sdk/agent-ui-terminal'),
      'packages/agent-ui-terminal/src/__tests__/pty/spawn-pty.ts':
        'export function spawnPty() {}\n',
    });

    expect(await findCapabilityPlacementFindings(root)).toEqual([
      {
        file: '.agents/project-structure.md',
        type: 'workspace-package-not-documented',
        detail:
          'packages/agent-ui-terminal is not covered by project-structure package family rules.',
      },
    ]);
  });

  it('does not restore the retired testing workspace admission from a stale document mention', async () => {
    const root = await createFixture({
      '.agents/project-structure.md': `${projectStructure}\n- agent-testing/\n`,
      'packages/agent-testing/package.json': packageJson('@robota-sdk/agent-testing'),
    });

    expect(await findCapabilityPlacementFindings(root)).toEqual([
      {
        file: '.agents/project-structure.md',
        type: 'workspace-package-not-documented',
        detail: 'packages/agent-testing is not covered by project-structure package family rules.',
      },
    ]);
  });

  it('still rejects product-shell imports into the relocated private PTY support', async () => {
    const root = await createFixture({
      '.agents/project-structure.md': projectStructure,
      'packages/agent-cli/package.json': packageJson('@robota-sdk/agent-cli'),
      'packages/agent-ui-terminal/package.json': packageJson('@robota-sdk/agent-ui-terminal'),
      'packages/agent-ui-terminal/docs/SPEC.md': '# TUI\nOwns src/__tests__/pty/ support.\n',
      'packages/agent-ui-terminal/src/__tests__/pty/spawn-pty.ts':
        'export function spawnPty() {}\n',
      'packages/agent-cli/src/cli.ts':
        'import { spawnPty } from "@robota-sdk/agent-ui-terminal/src/__tests__/pty/spawn-pty";\n',
    });

    expect(await findCapabilityPlacementFindings(root)).toEqual([
      {
        file: 'packages/agent-cli/src/cli.ts',
        type: 'product-shell-internal-import',
        detail:
          '@robota-sdk/agent-ui-terminal/src/__tests__/pty/spawn-pty reaches into implementation internals; import the owner package public API instead.',
      },
    ]);
  });

  it('ignores generation storage and retained output while still checking authored source', async () => {
    const declaration = 'export class BackgroundTaskRegistry {}\n';
    const root = await createFixture({
      '.agents/project-structure.md': projectStructure,
      'packages/agent-cli/package.json': packageJson('@robota-sdk/agent-cli'),
      'packages/agent-cli/src/live.ts': declaration,
      'packages/agent-cli/.robota-artifacts-source/live.ts': declaration,
      'packages/agent-cli/.robota-artifacts/generation/previous-dist/node/index.d.ts': declaration,
      'packages/agent-cli/.robota-artifacts/generation/dist/node/index.d.ts': declaration,
    });

    const findings = await findCapabilityPlacementFindings(root);
    expect(findings.map((finding) => finding.file.split(path.sep).join('/')).sort()).toEqual([
      'packages/agent-cli/.robota-artifacts-source/live.ts',
      'packages/agent-cli/src/live.ts',
    ]);
    expect(findings.every((finding) => finding.type === 'product-shell-background-registry')).toBe(
      true,
    );
  });

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
      'packages/agent-framework/package.json': packageJson('@robota-sdk/agent-framework'),
      'packages/agent-framework/docs/SPEC.md': '# Agent SDK SPEC\n',
      'packages/agent-cli/src/cli.ts':
        'import { InteractiveSession } from "@robota-sdk/agent-framework";\n',
    });

    const findings = await findCapabilityPlacementFindings(root);

    expect(findings).toEqual([]);
  });

  it('flags product-shell imports of unexported owner package subpaths', async () => {
    const root = await createFixture({
      '.agents/project-structure.md': projectStructure,
      'packages/agent-cli/package.json': packageJson('@robota-sdk/agent-cli'),
      'packages/agent-cli/docs/SPEC.md': '# Agent CLI SPEC\n',
      'packages/agent-framework/package.json': packageJson('@robota-sdk/agent-framework'),
      'packages/agent-framework/docs/SPEC.md': '# Agent SDK SPEC\n',
      'packages/agent-cli/src/cli.ts':
        'import { unsafe } from "@robota-sdk/agent-framework/internal";\n',
    });

    const findings = await findCapabilityPlacementFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-cli/src/cli.ts',
        type: 'composition-root-import-unexported-subpath',
        detail: '@robota-sdk/agent-framework/internal is not an exported owner package entry.',
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
