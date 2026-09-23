import { mkdirSync, readFileSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';
import { emitTsdown, prepareTsdownConfig } from '../emitters-tsdown.mjs';
import { emitVite, prepareViteConfig } from '../emitters-vite.mjs';
import { createManifest, verifyManifest } from '../manifest.mjs';

const repository = path.resolve(import.meta.dirname, '../../..');

function fixture() {
  const root = makeTemp('robota-artifact-emitter-');
  mkdirSync(path.join(root, 'src'));
  mkdirSync(path.join(root, 'node_modules'));
  const require = createRequire(path.join(repository, 'packages/agent-core/package.json'));
  const compilerRoot = path.dirname(path.dirname(require.resolve('tsdown')));
  symlinkSync(compilerRoot, path.join(root, 'node_modules/tsdown'), 'junction');
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'emitter-fixture',
      type: 'module',
      devDependencies: { tsdown: '*' },
    }),
  );
  writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        isolatedDeclarations: true,
      },
    }),
  );
  writeFileSync(path.join(root, 'src/index.ts'), 'export const answer: number = 42;\n');
  return root;
}

describe('tsdown artifact emitter', () => {
  it('rejects configurations that can bypass staging before invoking a compiler', () => {
    const packageRoot = path.resolve('fixture/package');
    const outputRoot = path.join(packageRoot, 'stage');
    expect(
      prepareTsdownConfig(
        { entry: ['src/index.ts'], outDir: 'dist/node' },
        { packageRoot, outputRoot },
      ),
    ).toMatchObject({
      config: false,
      cwd: packageRoot,
      outDir: path.join(outputRoot, 'node'),
      entry: ['src/index.ts'],
      clean: false,
    });
    for (const config of [
      { outDir: '../outside' },
      { watch: true },
      { workspace: true },
      { outputOptions: { dir: '/outside' } },
      { outputOptions: { file: '/outside/file.js' } },
      { cwd: '../other-package' },
    ]) {
      expect(() => prepareTsdownConfig(config, { packageRoot, outputRoot })).toThrow();
    }
  });
  it('loads real TS config and records complete node/browser/type emissions only in staging', async () => {
    const packageRoot = fixture();
    const outputRoot = path.join(packageRoot, 'generation');
    writeFileSync(
      path.join(packageRoot, 'tsdown.config.ts'),
      `
      import { defineConfig } from 'tsdown';
      const entry: string[] = ['src/index.ts'];
      const outExtensions = ({ format }: { format: string }) => ({ js: format === 'cjs' ? '.cjs' : '.js', dts: '.d.ts' });
      export default defineConfig([
        { entry, outDir: 'dist/node', format: ['esm', 'cjs'], dts: true, clean: true, outExtensions },
        { entry, outDir: 'dist/browser', format: ['esm'], platform: 'browser', dts: true },
      ]);
    `,
    );
    const records = await emitTsdown({ packageRoot, outputRoot });
    expect(records.map((record) => record.path)).toEqual(
      expect.arrayContaining([
        'node/index.js',
        'node/index.cjs',
        'node/index.d.ts',
        'browser/index.js',
        'browser/index.d.ts',
      ]),
    );
    for (const record of records) {
      expect(readFileSync(path.join(outputRoot, record.path))).toEqual(
        Buffer.from(record.contents),
      );
    }
    expect(existsSync(path.join(packageRoot, 'dist'))).toBe(false);
  });

  it('keeps executable bin ESM-only through config, with sourcemap bytes in the emission oracle', async () => {
    const packageRoot = fixture();
    const outputRoot = path.join(packageRoot, 'generation');
    writeFileSync(
      path.join(packageRoot, 'src/bin.ts'),
      '#!/usr/bin/env node\nprocess.stdout.write("fixture");\n',
    );
    writeFileSync(
      path.join(packageRoot, 'tsdown.config.ts'),
      `export default [
      { entry: ['src/index.ts'], format: ['esm', 'cjs'], outDir: 'dist/node', dts: true,
        outExtensions: ({format}) => ({js: format === 'cjs' ? '.cjs' : '.js', dts: format === 'cjs' ? '.d.cts' : '.d.ts'}) },
      { entry: ['src/bin.ts'], format: ['esm'], outDir: 'dist/node', dts: false, sourcemap: true, outExtensions: () => ({js: '.js'}) }
    ];`,
    );
    const records = await emitTsdown({ packageRoot, outputRoot });
    expect(records.map((record) => record.path)).toContain('node/bin.js');
    expect(records.map((record) => record.path)).not.toContain('node/bin.cjs');
    expect(records.map((record) => record.path)).not.toContain('node/bin.d.cts');
    expect(records.map((record) => record.path)).toContain('node/bin.js.map');
    verifyManifest(outputRoot, createManifest(records));
  });
});

describe('Vite artifact emitter', () => {
  it('confines Vite and nested Rollup output before real execution', () => {
    const packageRoot = path.resolve('fixture/package');
    const outputRoot = path.join(packageRoot, 'stage');
    expect(
      prepareViteConfig({ base: './', build: { outDir: 'dist/web' } }, { packageRoot, outputRoot }),
    ).toMatchObject({
      configFile: false,
      base: './',
      root: packageRoot,
      build: { outDir: path.join(outputRoot, 'web') },
    });
    for (const build of [
      { outDir: '../outside' },
      { watch: {} },
      { rollupOptions: { output: { dir: '../outside' } } },
      { rollupOptions: { output: [{ file: '../outside.js' }] } },
    ]) {
      expect(() => prepareViteConfig({ build }, { packageRoot, outputRoot })).toThrow();
    }
  });
  it('records real HTML, JS and declared public inputs without walking the emitted directory', async () => {
    const packageRoot = makeTemp('robota-artifact-vite-');
    const outputRoot = path.join(packageRoot, 'generation');
    mkdirSync(path.join(packageRoot, 'node_modules'));
    mkdirSync(path.join(packageRoot, 'public'));
    const require = createRequire(path.join(repository, 'packages/agent-cli-web/package.json'));
    const compilerRoot = path.resolve(path.dirname(require.resolve('vite')), '../..');
    symlinkSync(compilerRoot, path.join(packageRoot, 'node_modules/vite'), 'junction');
    writeFileSync(
      path.join(packageRoot, 'package.json'),
      '{"name":"vite-fixture","type":"module","devDependencies":{"vite":"*"}}',
    );
    writeFileSync(
      path.join(packageRoot, 'vite.config.ts'),
      `
      import { defineConfig } from 'vite';
      export default defineConfig({ base: './', build: { outDir: 'dist', minify: false } });
    `,
    );
    writeFileSync(
      path.join(packageRoot, 'index.html'),
      '<div id="app"></div><script type="module" src="/main.js"></script>',
    );
    writeFileSync(
      path.join(packageRoot, 'main.js'),
      'document.querySelector("#app").textContent = "fixture";',
    );
    writeFileSync(path.join(packageRoot, 'public/icon.txt'), 'declared public input');
    const records = await emitVite({ packageRoot, outputRoot });
    expect(records.map((record) => record.path)).toEqual(
      expect.arrayContaining(['index.html', 'icon.txt']),
    );
    expect(
      records.some((record) => record.path.startsWith('assets/') && record.path.endsWith('.js')),
    ).toBe(true);
    for (const record of records) {
      expect(readFileSync(path.join(outputRoot, record.path))).toEqual(
        Buffer.from(record.contents),
      );
    }
    expect(existsSync(path.join(packageRoot, 'dist'))).toBe(false);
  });
});
