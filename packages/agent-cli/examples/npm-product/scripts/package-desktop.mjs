import { resolve } from 'node:path';

import { build, Platform } from 'electron-builder';

const product = process.argv[2];
if (product !== 'cedar' && product !== 'amber') throw new Error('Choose cedar or amber.');
const root = resolve(import.meta.dirname, '..');
const executable = `${product}-runtime${process.platform === 'win32' ? '.exe' : ''}`;
const resources = [
  { from: resolve(root, `dist/native/${executable}`), to: `bin/${executable}` },
  { from: resolve(root, `dist/native/${executable}.THIRD_PARTY_NOTICES.txt`), to: `bin/${executable}.THIRD_PARTY_NOTICES.txt` },
  { from: resolve(root, `dist/renderer/${product}`), to: 'renderer' },
  { from: resolve(root, 'dist/THIRD_PARTY_NOTICES.md'), to: 'THIRD_PARTY_NOTICES.md' },
];
await build({
  targets: Platform.current().createTarget('dir'),
  publish: 'never',
  config: {
    appId: `example.${product}.agent`,
    productName: `${product[0].toUpperCase()}${product.slice(1)} Agent`,
    directories: { app: root, output: resolve(root, `dist/desktop/${product}`) },
    files: ['dist/electron/**/*', 'package.json'],
    extraResources: resources,
    extraMetadata: {
      main: `dist/electron/desktop/${product}.js`,
      name: `${product}-agent-fixture`,
      version: '1.0.0-pre.1',
    },
  },
});
