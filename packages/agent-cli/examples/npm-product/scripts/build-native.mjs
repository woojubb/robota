import { resolve } from 'node:path';

import { buildProductNativeBinary } from '@robota-sdk/agent-cli/native-build';

import { productArtifact } from '../src/shared/product.ts';

const product = process.argv[2];
if (product !== 'cedar' && product !== 'amber') throw new Error('Choose cedar or amber.');
const root = resolve(import.meta.dirname, '..');
const artifact = productArtifact(product, 'native');
const executable = `${product}-runtime${process.platform === 'win32' ? '.exe' : ''}`;
const result = await buildProductNativeBinary({
  entry: resolve(root, `src/native/${product}.ts`),
  outfile: resolve(root, `dist/native/${executable}`),
  version: artifact.version,
  sourceVersion: artifact.sourceVersion,
  buildMetadata: artifact.buildMetadata,
  noticesFile: resolve(root, 'dist/THIRD_PARTY_NOTICES.md'),
});
process.stdout.write(`${JSON.stringify(result)}\n`);
