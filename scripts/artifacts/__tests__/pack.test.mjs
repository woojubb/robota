import { expect, test, vi } from 'vitest';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  lstatSync,
  realpathSync,
  readdirSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';
import { createManifest } from '../manifest.mjs';
import { assembleGeneration, pinGeneration } from '../generation.mjs';
import { expectedPublishManifest } from '../pack-expected.mjs';
import { materializePackImage } from '../pack-image.mjs';
import { packVerifiedPackage, runPnpm } from '../pack.mjs';

test('derives pnpm publish metadata from the original manifest and workspace versions', () => {
  const original = {
    name: '@example/consumer',
    version: '1.2.3',
    files: ['dist'],
    dependencies: { '@example/core': 'workspace:*' },
    devDependencies: { '@example/core': 'workspace:^' },
    scripts: { prepack: 'refuse-direct-pack', test: 'vitest' },
    pnpm: { ignored: true },
  };
  expect(expectedPublishManifest(original, new Map([['@example/core', '2.3.4']]))).toEqual({
    name: '@example/consumer',
    version: '1.2.3',
    files: ['dist'],
    dependencies: { '@example/core': '2.3.4' },
    devDependencies: { '@example/core': '^2.3.4' },
    scripts: { test: 'vitest' },
  });
  expect(original.dependencies['@example/core']).toBe('workspace:*');
});

test('models pnpm removal and relocation of lifecycle scripts without changing other fields', () => {
  const original = {
    name: '@example/order',
    scripts: { prepack: 'guard', test: 'vitest' },
    dependencies: { example: '1.0.0' },
    pnpm: { ignored: true },
    version: '1.2.3',
  };
  const expected = {
    name: '@example/order',
    dependencies: { example: '1.0.0' },
    version: '1.2.3',
    scripts: { test: 'vitest' },
  };
  expect(JSON.stringify(expectedPublishManifest(original, new Map()), null, 2)).toBe(
    JSON.stringify(expected, null, 2),
  );
});

async function fixture() {
  const root = realpathSync(makeTemp('robota-pack-'));
  const packageRoot = path.join(root, 'packages/consumer');
  mkdirSync(path.join(root, 'packages/core'), { recursive: true });
  mkdirSync(packageRoot);
  const toolchain = JSON.parse(
    readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
  );
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      packageManager: toolchain.packageManager,
      volta: toolchain.volta,
      private: true,
    }),
  );
  writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  writeFileSync(path.join(root, 'LICENSE'), 'workspace license');
  writeFileSync(
    path.join(root, 'packages/core/package.json'),
    JSON.stringify({ name: '@example/core', version: '2.3.4' }),
  );
  const original = {
    name: '@example/consumer',
    version: '1.2.3',
    files: ['dist', 'bin', 'README.md', 'CHANGELOG.md'],
    main: 'dist/node/index.js',
    types: 'dist/types/index.d.ts',
    bin: { example: './bin/run.cjs' },
    dependencies: { '@example/core': 'workspace:*' },
    scripts: { prepack: 'node must-not-execute.mjs', prepare: 'node must-not-execute.mjs' },
  };
  writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify(original));
  mkdirSync(path.join(packageRoot, 'bin'));
  writeFileSync(path.join(packageRoot, 'bin/run.cjs'), '#!/usr/bin/env node\n');
  writeFileSync(path.join(packageRoot, 'README.md'), 'declared readme');
  writeFileSync(path.join(packageRoot, 'obsolete.txt'), 'must not ship');
  const records = [
    { path: 'node/index.js', contents: 'export const value = 1;' },
    { path: 'types/index.d.ts', contents: 'export declare const value: 1;' },
    { path: 'web/index.html', contents: '<html>same generation</html>' },
  ];
  const pinned = await assembleGeneration(packageRoot, async ({ outputRoot }) => {
    for (const record of records) {
      mkdirSync(path.dirname(path.join(outputRoot, record.path)), { recursive: true });
      writeFileSync(path.join(outputRoot, record.path), record.contents);
    }
    return createManifest(records);
  });
  return { root, packageRoot, pinned, original };
}

test('materializes only pinned records and declared static files as real files with independent expectations', async () => {
  const { root, packageRoot, pinned, original } = await fixture();
  const imageRoot = path.join(root, 'image');
  const image = materializePackImage({ packageRoot, imageRoot, pinned, workspaceRoot: root });
  expect(lstatSync(path.join(imageRoot, 'dist')).isSymbolicLink()).toBe(false);
  expect(readFileSync(path.join(imageRoot, 'dist/web/index.html'), 'utf8')).toContain(
    'same generation',
  );
  expect(image.expectedFiles.map((record) => record.path).sort()).toEqual([
    'LICENSE',
    'README.md',
    'bin/run.cjs',
    'dist/node/index.js',
    'dist/types/index.d.ts',
    'dist/web/index.html',
    'package.json',
  ]);
  expect(image.expectedFiles.find((record) => record.path === 'dist/node/index.js').sha256).toBe(
    pinned.manifest.files[0].sha256,
  );
  expect(image.expectedFiles.find((record) => record.path === 'bin/run.cjs').mode).toBe(0o755);
  expect(image.manifest.dependencies['@example/core']).toBe('2.3.4');
  expect(JSON.parse(readFileSync(path.join(imageRoot, 'package.json'), 'utf8'))).toEqual(original);
  expect(
    JSON.parse(
      readFileSync(path.join(imageRoot, 'node_modules/@example/core/package.json'), 'utf8'),
    ),
  ).toEqual({ name: '@example/core', version: '2.3.4' });
});

test('refuses unmodelled manifest inclusion and publish transformations instead of guessing', () => {
  const original = { name: '@example/package', version: '1.0.0', files: ['dist'] };
  for (const extra of [
    { publishConfig: { directory: 'release' } },
    { publishConfig: { main: 'other.js' } },
    { bundledDependencies: ['dependency'] },
    { bundleDependencies: true },
    { directories: { bin: 'commands' } },
    { dependencies: { alias: 'workspace:other@*' } },
  ]) {
    expect(() => expectedPublishManifest({ ...original, ...extra }, new Map())).toThrow(
      /unsupported/,
    );
  }
});

test('the direct package pack guard refuses without running build or packaging commands', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../pack-guard.mjs', import.meta.url))],
    { encoding: 'utf8' },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Direct package-directory packing is unsupported');
  expect(result.stderr).toContain('scripts/artifacts/pack.mjs');
});

test('real pinned pnpm packs an ordinary image, transforms workspace dependencies and returns verified tarball bytes', async () => {
  const { root, packageRoot, pinned } = await fixture();
  const result = await packVerifiedPackage(packageRoot, {
    workspaceRoot: root,
    destination: path.join(root, 'tarballs'),
  }).catch((error) => {
    throw new Error(`${error.message}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`);
  });
  expect(result).toMatchObject({
    packageName: '@example/consumer',
    version: '1.2.3',
    generationId: pinned.id,
  });
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(lstatSync(result.tarballPath).isFile()).toBe(true);
  expect(result.files.map((record) => record.path)).toContain('dist/web/index.html');
  expect(lstatSync(path.join(packageRoot, 'dist')).isSymbolicLink()).toBe(true);
});

test('reads the toolchain pin from its owner rather than maintaining a second version pin', async () => {
  const { root, packageRoot } = await fixture();
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@8.15.5' }));
  await expect(
    packVerifiedPackage(packageRoot, {
      workspaceRoot: root,
      destination: path.join(root, 'tarballs'),
      run: (args) => {
        if (args[0] === '--version') return '8.15.5\n';
        throw new Error('reached pack with declared pin');
      },
    }),
  ).rejects.toThrow('reached pack with declared pin');
});

test('rejects an executable declaration absent from the expected complete image', async () => {
  const { root, packageRoot, pinned, original } = await fixture();
  writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ ...original, bin: { example: './dist/missing.js' } }),
  );
  expect(() =>
    materializePackImage({
      packageRoot,
      imageRoot: path.join(root, 'image'),
      pinned,
      workspaceRoot: root,
    }),
  ).toThrow(/missing executable/);
});

test('propagates pack failure and removes only its image while preserving the generation and existing destination', async () => {
  const { root, packageRoot, pinned } = await fixture();
  const destination = path.join(root, 'tarballs');
  mkdirSync(destination);
  writeFileSync(path.join(destination, 'keep.tgz'), 'user tarball');
  const version = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8'),
  ).packageManager.slice('pnpm@'.length);
  const run = vi.fn((args) => {
    if (args[0] === '--version') return version;
    expect(args).toContain('--config.ignore-scripts=true');
    expect(lstatSync(path.join(args[1], 'dist')).isDirectory()).toBe(true);
    throw new Error('pack subprocess failed');
  });
  await expect(
    packVerifiedPackage(packageRoot, { workspaceRoot: root, destination, run }),
  ).rejects.toThrow('pack subprocess failed');
  expect(pinGeneration(packageRoot)).toEqual(pinned);
  expect(readdirSync(path.join(packageRoot, '.robota-artifacts'))).toEqual([pinned.id]);
  expect(readFileSync(path.join(destination, 'keep.tgz'), 'utf8')).toBe('user tarball');
  expect(run).toHaveBeenCalledTimes(2);
});

test.each(['obsolete', 'changed', 'symlink', 'glob'])(
  'refuses %s source input without issuing a pack command',
  async (defect) => {
    const { root, packageRoot, pinned, original } = await fixture();
    if (defect === 'obsolete') writeFileSync(path.join(pinned.root, 'obsolete.js'), 'old');
    if (defect === 'changed') writeFileSync(path.join(pinned.root, 'node/index.js'), 'changed');
    if (defect === 'symlink') {
      symlinkSync('README.md', path.join(packageRoot, 'linked.md'));
      writeFileSync(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ ...original, files: ['dist', 'linked.md'] }),
      );
    }
    if (defect === 'glob')
      writeFileSync(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ ...original, files: ['dist', '**/*.md'] }),
      );
    const version = JSON.parse(
      readFileSync(path.join(root, 'package.json'), 'utf8'),
    ).packageManager.slice('pnpm@'.length);
    const run = vi.fn(() => version);
    await expect(
      packVerifiedPackage(packageRoot, {
        workspaceRoot: root,
        destination: path.join(root, 'tarballs'),
        run,
      }),
    ).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toEqual(['--version']);
    expect(existsSync(path.join(root, 'tarballs'))).toBe(false);
  },
);

test('a pack-time image mutation cannot redefine the expected generation or produce a publishable result', async () => {
  const { root, packageRoot, pinned } = await fixture();
  await expect(
    packVerifiedPackage(packageRoot, {
      workspaceRoot: root,
      destination: path.join(root, 'tarballs'),
      run: (args, options) => {
        if (args[0] !== '--version')
          writeFileSync(path.join(args[1], 'dist/web/index.html'), 'mixed generation');
        return runPnpm(args, options);
      },
    }),
  ).rejects.toThrow(/content mismatch/);
  expect(pinGeneration(packageRoot)).toEqual(pinned);
  expect(existsSync(path.join(root, 'tarballs'))).toBe(false);
});

test('does not overwrite an existing tarball with the same package name and version', async () => {
  const { root, packageRoot, pinned } = await fixture();
  const destination = path.join(root, 'tarballs');
  mkdirSync(destination);
  const existing = path.join(destination, 'example-consumer-1.2.3.tgz');
  writeFileSync(existing, 'preserve this tarball');
  await expect(
    packVerifiedPackage(packageRoot, { workspaceRoot: root, destination }),
  ).rejects.toThrow(/EEXIST/);
  expect(readFileSync(existing, 'utf8')).toBe('preserve this tarball');
  expect(pinGeneration(packageRoot)).toEqual(pinned);
});

test('refuses a destination through dist so packing cannot mutate a sealed generation', async () => {
  const { root, packageRoot, pinned } = await fixture();
  await expect(
    packVerifiedPackage(packageRoot, {
      workspaceRoot: root,
      destination: path.join(packageRoot, 'dist/tarballs'),
    }),
  ).rejects.toThrow(/destination.*generation/);
  expect(pinGeneration(packageRoot)).toEqual(pinned);
});

test('real direct pnpm pack executes the refusal hook before accepting a symlink dist', async () => {
  const { root, packageRoot, pinned, original } = await fixture();
  const guard = fileURLToPath(new URL('../pack-guard.mjs', import.meta.url));
  writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({
      ...original,
      scripts: { prepack: `node ${JSON.stringify(guard)}` },
    }),
  );
  let failure;
  try {
    runPnpm(['--dir', packageRoot, 'pack', '--pack-destination', path.join(root, 'tarballs')], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (error) {
    failure = error;
  }
  expect(failure?.status).toBe(1);
  expect(String(failure?.stderr)).toContain('Direct package-directory packing is unsupported');
  expect(existsSync(path.join(root, 'tarballs'))).toBe(false);
  expect(pinGeneration(packageRoot)).toEqual(pinned);
});
