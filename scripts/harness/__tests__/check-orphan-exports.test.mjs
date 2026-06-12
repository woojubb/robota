import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findOrphanExportFindings } from '../check-orphan-exports.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-orphan-exports-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

const PKG = JSON.stringify({ name: '@robota-sdk/foo', version: '0.0.0' });

describe('check-orphan-exports', () => {
  it('flags a runtime export with no references anywhere', async () => {
    const root = await createFixture({
      'packages/foo/package.json': PKG,
      'packages/foo/src/dead-feature.ts': 'export function printWelcomeBanner(): void {}\n',
      'packages/foo/src/index.ts': "export const VERSION = '1';\n",
    });
    const findings = await findOrphanExportFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('orphan-export');
    expect(findings[0].detail).toContain('printWelcomeBanner');
  });

  it('does not flag symbols referenced from another package', async () => {
    const root = await createFixture({
      'packages/foo/package.json': PKG,
      'packages/foo/src/feature.ts': 'export function runFeature(): void {}\n',
      'packages/bar/package.json': JSON.stringify({ name: '@robota-sdk/bar' }),
      'packages/bar/src/consumer.ts':
        "import { runFeature } from '@robota-sdk/foo';\nrunFeature();\n",
    });
    expect(await findOrphanExportFindings(root)).toHaveLength(0);
  });

  it('exempts entry-point files', async () => {
    const root = await createFixture({
      'packages/foo/package.json': PKG,
      'packages/foo/src/index.ts': 'export function publicApi(): void {}\n',
    });
    expect(await findOrphanExportFindings(root)).toHaveLength(0);
  });

  it('exempts modules re-exported through a barrel', async () => {
    const root = await createFixture({
      'packages/foo/package.json': PKG,
      'packages/foo/src/surface.ts': 'export function externalOnlyApi(): void {}\n',
      'packages/foo/src/index.ts': "export * from './surface.js';\n",
    });
    expect(await findOrphanExportFindings(root)).toHaveLength(0);
  });

  it('honors the allowlist', async () => {
    const root = await createFixture({
      'packages/foo/package.json': PKG,
      'packages/foo/src/kept.ts': 'export function intentionallyUnused(): void {}\n',
      'packages/foo/src/index.ts': "export const VERSION = '1';\n",
    });
    const findings = await findOrphanExportFindings(root, {
      allowlist: new Set(['intentionallyUnused']),
    });
    expect(findings).toHaveLength(0);
  });

  it('ignores type-only exports in v1', async () => {
    const root = await createFixture({
      'packages/foo/package.json': PKG,
      'packages/foo/src/types.ts':
        'export interface IUnusedShape { x: number }\nexport type TUnusedAlias = string;\n',
      'packages/foo/src/index.ts': "export const VERSION = '1';\n",
    });
    expect(await findOrphanExportFindings(root)).toHaveLength(0);
  });

  it('flags symbols only referenced in their own file', async () => {
    const root = await createFixture({
      'packages/foo/package.json': PKG,
      'packages/foo/src/self.ts': 'export function selfCaller(): void { selfCaller(); }\n',
      'packages/foo/src/index.ts': "export const VERSION = '1';\n",
    });
    const findings = await findOrphanExportFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('selfCaller');
  });
});

describe('ARCH-002 incident replica (TC-02)', () => {
  it('detects the orphaned first-run and terminal-check exports of commit 05beb9f2e', async () => {
    const root = await createFixture({
      'packages/agent-cli/package.json': PKG,
      'packages/agent-cli/src/startup/first-run.ts': [
        'export function isFirstRun(): boolean {',
        '  return true;',
        '}',
        'export function markOnboarded(): void {}',
        'export function printFirstRunWelcome(): void {',
        "  process.stderr.write('welcome');",
        '}',
      ].join('\n'),
      'packages/agent-cli/src/startup/terminal-check.ts':
        'export function warnIfTerminalAppOnMacOS(): void {}\n',
      'packages/agent-cli/src/cli.ts':
        "import { runResetConfig } from './startup/reset-config.js';\nexport async function startCli(): Promise<void> { runResetConfig(); }\n",
      'packages/agent-cli/src/startup/reset-config.ts':
        'export function runResetConfig(): void {}\n',
      'packages/agent-cli/src/bin.ts': "import { startCli } from './cli.js';\nstartCli();\n",
    });
    const findings = await findOrphanExportFindings(root);
    const symbols = findings.map((f) => f.detail.split(' ')[0]).sort();
    expect(symbols).toEqual([
      'isFirstRun',
      'markOnboarded',
      'printFirstRunWelcome',
      'warnIfTerminalAppOnMacOS',
    ]);
  });
});
