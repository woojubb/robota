import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';

const repository = path.resolve(import.meta.dirname, '../../..');

function compilerLink(packageRoot, compiler, installedOwner) {
  mkdirSync(path.join(packageRoot, 'node_modules'));
  const require = createRequire(path.join(repository, 'packages', installedOwner, 'package.json'));
  const entry = require.resolve(compiler);
  const compilerRoot =
    compiler === 'vite'
      ? path.resolve(path.dirname(entry), '../..')
      : path.resolve(path.dirname(entry), '..');
  symlinkSync(compilerRoot, path.join(packageRoot, 'node_modules', compiler), 'junction');
}

export function writeConsumerConfig(consumer, includeLegacy = true) {
  const entry = { index: 'src/index.ts', ...(includeLegacy ? { legacy: 'src/legacy.ts' } : {}) };
  writeFileSync(
    path.join(consumer, 'tsdown.config.ts'),
    `
    const entry: Record<string, string> = ${JSON.stringify(entry)};
    const shared = { entry, dts: true, outExtensions: ({format}: {format: string}) => ({js: format === 'cjs' ? '.cjs' : '.js', dts: '.d.ts'}) };
    export default [
      { ...shared, outDir: 'dist/node', format: { esm: {}, cjs: { dts: false } } },
      { ...shared, outDir: 'dist/browser', format: ['esm'], platform: 'browser' }
    ];
  `,
  );
}

export function releaseWorkspace() {
  const root = realpathSync(makeTemp('robota-release-path-'));
  const consumer = path.join(root, 'packages/consumer');
  const web = path.join(root, 'packages/web');
  const toolchain = JSON.parse(readFileSync(path.join(repository, 'package.json'), 'utf8'));
  const build = `node ${JSON.stringify(path.join(repository, 'scripts/artifacts/build-package.mjs'))}`;
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      packageManager: toolchain.packageManager,
      volta: toolchain.volta,
    }),
  );
  writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  writeFileSync(path.join(root, 'LICENSE'), 'Release fixture license');
  mkdirSync(path.join(consumer, 'src'), { recursive: true });
  mkdirSync(web, { recursive: true });
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({
      name: '@fixture/consumer',
      version: '1.0.0',
      type: 'module',
      files: ['dist'],
      main: 'dist/node/index.js',
      types: 'dist/node/index.d.ts',
      devDependencies: { tsdown: '*', '@fixture/web': 'workspace:*' },
      scripts: { build },
      robota: {
        artifact: { builder: 'tsdown', copies: [{ package: '@fixture/web', target: 'web' }] },
      },
    }),
  );
  writeFileSync(
    path.join(web, 'package.json'),
    JSON.stringify({
      name: '@fixture/web',
      version: '1.0.0',
      private: true,
      type: 'module',
      devDependencies: { vite: '*' },
      scripts: { build },
      robota: { artifact: { builder: 'vite' } },
    }),
  );
  compilerLink(consumer, 'tsdown', 'agent-core');
  compilerLink(web, 'vite', 'agent-cli-web');
  writeFileSync(
    path.join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        isolatedDeclarations: true,
      },
    }),
  );
  writeFileSync(path.join(consumer, 'src/index.ts'), 'export const current: number = 42;');
  writeFileSync(path.join(consumer, 'src/legacy.ts'), 'export const legacy: string = "remove-me";');
  writeConsumerConfig(consumer);
  writeFileSync(
    path.join(web, 'vite.config.ts'),
    "export default {base:'./',build:{outDir:'dist',minify:false}};",
  );
  writeFileSync(
    path.join(web, 'index.html'),
    '<div id="app"></div><script type="module" src="/main.js"></script>',
  );
  writeFileSync(
    path.join(web, 'main.js'),
    'document.querySelector("#app").textContent = "release-web";',
  );
  return { root, consumer, web };
}
