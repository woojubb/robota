import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createKoffiBunPlugin } from '../../../scripts/bun/koffi-bun-plugin.mjs';

const outputArgument = process.argv.slice(2).find((argument) => argument !== '--');
const output = resolve(outputArgument ?? 'dist-qualification/native-qualification');
mkdirSync(dirname(output), { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(dirname(fileURLToPath(import.meta.url)), 'qualify-native.mjs')],
  target: 'bun',
  format: 'cjs',
  compile: { outfile: output },
  plugins: [createKoffiBunPlugin(`${process.platform}-${process.arch}`, import.meta.url)],
});
if (!result.success) {
  throw new Error(`Native qualification compile failed: ${result.logs.map(String).join('\n')}`);
}
process.stdout.write(`${output}\n`);
