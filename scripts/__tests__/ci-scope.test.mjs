import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { assertNativeGate, selectScope } from '../ci.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ci-scope-'));
  roots.push(root);
  for (const dir of ['packages/agent-core', 'packages/agent-extra', 'packages/agent-organization-host', 'packages/agent-cli', 'apps/agent-app'])
    mkdirSync(path.join(root, dir), { recursive: true });
  const write = (file, data) => writeFileSync(path.join(root, file), typeof data === 'string' ? data : `${JSON.stringify(data)}\n`);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const commit = () => { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture'); };
  write('package.json', { name: 'scope-fixture', private: true, packageManager: 'pnpm@8.15.4' });
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n  - apps/*\n');
  write('.npmrc', 'link-workspace-packages=false\n');
  write('packages/agent-core/package.json', { name: '@fixture/core', version: '1.0.0', devDependencies: { '@fixture/extra': 'workspace:*' } });
  write('packages/agent-extra/package.json', { name: '@fixture/extra', version: '1.0.0' });
  write('packages/agent-organization-host/package.json', { name: '@fixture/organization-host', version: '1.0.0' });
  write('packages/agent-cli/package.json', { name: '@fixture/cli', version: '1.0.0', devDependencies: { '@fixture/core': 'npm:@fixture/core@1.0.0' } });
  write('apps/agent-app/package.json', { name: '@fixture/app', version: '1.0.0', dependencies: { '@fixture/cli': 'workspace:*' } });
  const lock = (importer, snapshot = '{}') => `lockfileVersion: "6.0"\nimporters:\n  packages/agent-core:\n    dependencies: ${importer}\n  packages/agent-cli:\n    dependencies: {}\n  apps/agent-app:\n    dependencies: {}\npackages:\n  /other@1.0.0:\n    resolution: ${snapshot}\n`;
  write('pnpm-lock.yaml', lock('{}'));
  git('init', '-q');
  commit();
  return { root, write, commit, lock, base: git('rev-parse', 'HEAD') };
}

it('keeps pinned products out of SDK version and importer changes', () => {
  const f = fixture();
  f.write('packages/agent-core/package.json', { name: '@fixture/core', version: '1.0.1', devDependencies: { '@fixture/extra': 'workspace:*' } });
  f.write('pnpm-lock.yaml', f.lock('{changed: true}'));
  f.commit();
  const sdk = selectScope({ cwd: f.root, event: 'pull_request', base: f.base });
  expect(sdk.full).toBe(false);
  expect(sdk.checks).toContain('packages/agent-core');
  expect(sdk.checks).not.toContain('packages/agent-cli');
  expect(sdk.checks).not.toContain('apps/agent-app');
  expect(sdk.windowsChecks).toEqual([]);
  f.write('packages/agent-cli/change.ts', 'export {};\n');
  f.commit();
  const product = selectScope({ cwd: f.root, event: 'pull_request', base: f.base });
  expect(product.checks).toContain('packages/agent-cli');
  expect(product.checks).toContain('apps/agent-app');
});

it('falls back to full validation when a shared lockfile snapshot changes', () => {
  const f = fixture();
  f.write('packages/agent-core/package.json', { name: '@fixture/core', version: '1.0.1', devDependencies: { '@fixture/extra': 'workspace:*' } });
  f.write('pnpm-lock.yaml', f.lock('{changed: true}', '{integrity: changed}'));
  f.commit();
  expect(selectScope({ cwd: f.root, event: 'pull_request', base: f.base }).full).toBe(true);
});

it('skips Windows package tests for a workspace range migration but keeps them for dependency changes', () => {
  const f = fixture();
  f.write('packages/agent-core/package.json', { name: '@fixture/core', version: '1.0.0', devDependencies: { '@fixture/extra': 'workspace:^' } });
  f.commit();
  expect(selectScope({ cwd: f.root, event: 'pull_request', base: f.base }).windowsChecks).toEqual([]);
  f.write('packages/agent-core/package.json', { name: '@fixture/core', version: '1.0.0', devDependencies: { '@fixture/extra': 'workspace:^' }, optionalDependencies: { koffi: '^1.0.0' } });
  f.commit();
  const plan = selectScope({ cwd: f.root, event: 'pull_request', base: f.base });
  expect(plan.windowsChecks).toEqual(['packages/agent-core']);
  expect(plan.windows).toBe(true);
});

it('requires Windows tests for a platform-sensitive SDK change without rebuilding the product', () => {
  const f = fixture();
  f.write('packages/agent-core/platform.ts', 'export const platform = process.platform;\n');
  f.commit();
  const plan = selectScope({ cwd: f.root, event: 'pull_request', base: f.base });
  expect(plan.windowsChecks).toEqual(['packages/agent-core']);
  expect(plan.checks).not.toContain('packages/agent-cli');
  const needs = { scope: { result: 'success', outputs: { plan: JSON.stringify(plan) } },
    'build-bun': { result: 'skipped' }, 'sdk-windows': { result: 'success' } };
  expect(() => assertNativeGate(needs)).not.toThrow();
  needs['sdk-windows'].result = 'skipped';
  expect(() => assertNativeGate(needs)).toThrow('Windows SDK checks');
});

it('does not turn an ordinary SDK source change into a Windows check when only its version also changes', () => {
  const f = fixture();
  f.write('packages/agent-extra/index.ts', 'export const value = 1;\n');
  f.write('packages/agent-extra/package.json', { name: '@fixture/extra', version: '1.0.1' });
  f.commit();
  const plan = selectScope({ cwd: f.root, event: 'pull_request', base: f.base });
  expect(plan.windowsChecks).toEqual(['packages/agent-extra']);
  expect(plan.windows).toBe(false);
});

it('selects the Windows suite of agent-organization-host when that package changes and not otherwise', () => {
  const f = fixture();
  f.write('packages/agent-extra/index.ts', 'export const value = 1;\n');
  f.commit();
  expect(selectScope({ cwd: f.root, event: 'pull_request', base: f.base }).windowsChecks).not.toContain('packages/agent-organization-host');
  f.write('packages/agent-organization-host/index.ts', 'export const value = 1;\n');
  f.commit();
  const plan = selectScope({ cwd: f.root, event: 'pull_request', base: f.base });
  expect(plan.windowsChecks).toContain('packages/agent-organization-host');
  expect(plan.windows).toBe(true);
});

it('widens the scope for a root input that feeds no binary without building native binaries', () => {
  const f = fixture();
  mkdirSync(path.join(f.root, 'scripts'), { recursive: true });
  f.write('scripts/lint.mjs', 'export {};\n');
  f.commit();
  const plan = selectScope({ cwd: f.root, event: 'pull_request', base: f.base });
  expect(plan.full).toBe(true);
  expect(plan.native).toBe(false);
  const needs = (build, sdk) => ({ scope: { result: 'success', outputs: { plan: JSON.stringify(plan) } },
    'build-bun': { result: build }, 'sdk-windows': { result: sdk } });
  expect(() => assertNativeGate(needs('skipped', 'success'))).not.toThrow();
  expect(() => assertNativeGate(needs('success', 'skipped'))).toThrow('Native builds');
});

it('keeps native binaries for a root input a binary build uses and for a change next to one', () => {
  const f = fixture();
  mkdirSync(path.join(f.root, 'scripts/release'), { recursive: true });
  f.write('scripts/release/pack.mjs', 'export {};\n');
  f.commit();
  expect(selectScope({ cwd: f.root, event: 'pull_request', base: f.base }).native).toBe(true);
  const next = fixture();
  mkdirSync(path.join(next.root, 'scripts'), { recursive: true });
  next.write('scripts/lint.mjs', 'export {};\n');
  next.write('packages/agent-cli/change.ts', 'export {};\n');
  next.commit();
  const plan = selectScope({ cwd: next.root, event: 'pull_request', base: next.base });
  expect(plan.full).toBe(true);
  expect(plan.native).toBe(true);
});

it('keeps native binaries for an unlisted root input such as the shared tsconfig', () => {
  const f = fixture();
  f.write('tsconfig.base.json', '{}\n');
  f.commit();
  const plan = selectScope({ cwd: f.root, event: 'pull_request', base: f.base });
  expect(plan.full).toBe(true);
  expect(plan.native).toBe(true);
  const docs = fixture();
  mkdirSync(path.join(docs.root, 'diagrams'), { recursive: true });
  docs.write('diagrams/flow.svg', '<svg/>\n');
  docs.write('.gitattributes', '* text=auto\n');
  docs.commit();
  expect(selectScope({ cwd: docs.root, event: 'pull_request', base: docs.base }).native).toBe(false);
});

it('does not build native binaries for an ARCHITECTURE.md change alone', () => {
  const f = fixture();
  f.write('ARCHITECTURE.md', '# Architecture\n');
  f.commit();
  const plan = selectScope({ cwd: f.root, event: 'pull_request', base: f.base });
  expect(plan.full).toBe(true);
  expect(plan.reason).toBe('runtime-platform lists: ARCHITECTURE.md');
  expect(plan.native).toBe(false);
});

it('still builds native binaries for every other full plan', () => {
  const f = fixture();
  f.write('packages/agent-core/package.json', { name: '@fixture/core', version: '1.0.1', devDependencies: { '@fixture/extra': 'workspace:*' } });
  f.write('pnpm-lock.yaml', f.lock('{changed: true}', '{integrity: changed}'));
  f.commit();
  expect(selectScope({ cwd: f.root, event: 'pull_request', base: f.base }).native).toBe(true);
  expect(selectScope({ cwd: f.root, event: 'workflow_dispatch', base: f.base }).native).toBe(true);
});
