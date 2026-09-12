import { expect, it } from 'vitest';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readArtifactCapability } from '../capability.mjs';
import { buildPackage } from '../build-package.mjs';
import { assembleGeneration, pinGeneration } from '../generation.mjs';
import { createManifest } from '../manifest.mjs';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';

it('reads the declared builder and rejects unsafe or ambiguous copy capabilities', () => {
  expect(readArtifactCapability({ name: 'ordinary' })).toBeUndefined();
  const artifact = {
    builder: 'tsdown',
    copies: [{ package: '@robota-sdk/agent-cli-web', target: 'web' }],
  };
  expect(readArtifactCapability({ robota: { artifact } })).toEqual(artifact);
  for (const invalid of [
    { builder: 'shell' },
    { builder: 'vite', copies: [{ package: 'producer', target: '../outside' }] },
    { builder: 'vite', copies: [{ package: 'producer', target: '/outside' }] },
    {
      builder: 'vite',
      copies: [
        { package: 'producer', target: 'web' },
        { package: 'other', target: 'web/nested' },
      ],
    },
  ]) {
    expect(() => readArtifactCapability({ robota: { artifact: invalid } })).toThrow();
  }
});

it('preserves optional variants and rejects outputs that alias dist or another variant', () => {
  const artifact = { builder: 'tsdown', variants: { bun: { output: 'dist-bun' } } };
  expect(readArtifactCapability({ robota: { artifact } })).toEqual(artifact);
  for (const variants of [
    null,
    [],
    'bun',
    { bun: null },
    { bun: {} },
    { bun: { output: 'dist' } },
    { bun: { output: '../dist-bun' } },
    { bun: { output: 'dist/bun' } },
    { '../bun': { output: 'dist-bun' } },
    { bun: { output: 'dist-bun' }, other: { output: 'dist-bun' } },
  ]) {
    expect(() =>
      readArtifactCapability({ robota: { artifact: { builder: 'tsdown', variants } } }),
    ).toThrow();
  }
});

async function buildFixture() {
  const workspace = makeTemp('robota-artifact-build-');
  const producer = path.join(workspace, 'modules/nested/ui');
  const consumer = path.join(workspace, 'modules/apps/cli');
  mkdirSync(producer, { recursive: true });
  mkdirSync(path.join(consumer, 'src'), { recursive: true });
  mkdirSync(path.join(consumer, 'node_modules'));
  writeFileSync(path.join(workspace, 'pnpm-workspace.yaml'), 'packages:\n  - modules/*/*\n');
  writeFileSync(
    path.join(producer, 'package.json'),
    JSON.stringify({
      name: '@fixture/ui',
      scripts: { build: 'unused' },
      robota: { artifact: { builder: 'vite' } },
    }),
  );
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({
      name: '@fixture/cli',
      type: 'module',
      scripts: { build: 'unused' },
      devDependencies: { tsdown: '*' },
      robota: {
        artifact: {
          builder: 'tsdown',
          copies: [{ package: '@fixture/ui', target: 'web' }],
        },
      },
    }),
  );
  const require = createRequire(
    path.resolve(import.meta.dirname, '../../../packages/agent-core/package.json'),
  );
  symlinkSync(
    path.resolve(path.dirname(require.resolve('tsdown')), '..'),
    path.join(consumer, 'node_modules/tsdown'),
    'junction',
  );
  writeFileSync(path.join(consumer, 'src/index.ts'), 'export const answer = 42;');
  writeFileSync(
    path.join(consumer, 'tsdown.config.ts'),
    "export default {entry:['src/index.ts'],format:['esm'],dts:false,outDir:'dist/node'};",
  );
  const pinned = await assembleGeneration(producer, async ({ outputRoot }) => {
    writeFileSync(path.join(outputRoot, 'index.html'), 'verified web');
    return createManifest([{ path: 'index.html', contents: 'verified web' }]);
  });
  return { workspace, producer, consumer, pinned };
}

it('builds a complete generation and copies a verified producer resolved by workspace name', async () => {
  const { consumer, pinned } = await buildFixture();
  const built = await buildPackage(consumer);
  expect(readFileSync(path.join(built.root, 'web/index.html'), 'utf8')).toBe('verified web');
  expect(built.manifest.files.find((file) => file.path === 'web/index.html')).toEqual({
    ...pinned.manifest.files[0],
    path: 'web/index.html',
  });
  expect(built.manifest.files.some((file) => file.path.startsWith('node/index.'))).toBe(true);
});

it('propagates a real compiler failure without replacing the consumer generation', async () => {
  const { consumer } = await buildFixture();
  const previous = await buildPackage(consumer);
  writeFileSync(path.join(consumer, 'src/index.ts'), 'export const = ;');
  await expect(buildPackage(consumer)).rejects.toThrow();
  expect(pinGeneration(consumer).id).toBe(previous.id);
});

it('rejects a modified producer against its pinned manifest rather than blessing copied bytes', async () => {
  const { consumer, pinned } = await buildFixture();
  const previous = await buildPackage(consumer);
  writeFileSync(path.join(pinned.root, 'index.html'), 'corrupted after emission');
  await expect(buildPackage(consumer)).rejects.toThrow(/mismatch/);
  expect(pinGeneration(consumer).id).toBe(previous.id);
});

it('rejects unrecorded post-build files instead of using an output walk as the expected set', async () => {
  const { consumer } = await buildFixture();
  writeFileSync(
    path.join(consumer, 'tsdown.config.ts'),
    `
    import { writeFileSync } from 'node:fs';
    import path from 'node:path';
    export default { entry: ['src/index.ts'], format: ['esm'], dts: false, outDir: 'dist/node',
      hooks: { 'build:done': (ctx) => writeFileSync(path.join(ctx.options.outDir, 'unrecorded.txt'), 'unexpected') }
    };
  `,
  );
  await expect(buildPackage(consumer)).rejects.toThrow(/unexpected file.*unrecorded/);
});

it('runs the real package-cwd CLI and reports a nonzero compiler failure', async () => {
  const { consumer } = await buildFixture();
  const driver = path.resolve(import.meta.dirname, '../build-package.mjs');
  const green = spawnSync(process.execPath, [driver], {
    cwd: consumer,
    encoding: 'utf8',
    timeout: 15000,
  });
  expect(green.status, green.stderr).toBe(0);
  expect(green.stdout).toMatch(/artifact generation .*: \d+ files/);
  const previous = pinGeneration(consumer);
  writeFileSync(path.join(consumer, 'src/index.ts'), 'export const = ;');
  const red = spawnSync(process.execPath, [driver], {
    cwd: consumer,
    encoding: 'utf8',
    timeout: 15000,
  });
  expect(red.status).toBe(1);
  expect(red.stderr).toContain('artifact build failed:');
  expect(pinGeneration(consumer).id).toBe(previous.id);
});
