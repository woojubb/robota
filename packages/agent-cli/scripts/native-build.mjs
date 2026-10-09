import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

import { createKoffiBunPlugin } from './koffi-bun-plugin.mjs';

const TARGETS = Object.freeze({
  'darwin-arm64': 'bun-darwin-arm64',
  'darwin-x64': 'bun-darwin-x64',
  'linux-arm64': 'bun-linux-arm64',
  'linux-x64': 'bun-linux-x64',
  'windows-x64': 'bun-windows-x64',
});

const stubReactDevtools = {
  name: 'stub-react-devtools',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: 'rdc', namespace: 'stub-rdc',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub-rdc' }, () => ({
      contents: 'export default {}; export function connectToDevTools(){}', loader: 'js',
    }));
  },
};

/**
 * Compile a consumer-owned CLI entry against installed npm dependencies. The entry must call
 * createProductCliHost on every process start, including daemon and worker re-entry.
 * Run this function under Bun on the target host after qualifying native-addon GC.
 */
export async function buildProductNativeBinary(options) {
  if (!process.versions.bun) throw new Error('Native CLI packaging requires Bun.');
  const { entry, outfile, version, noticesFile } = options;
  if (![entry, outfile, noticesFile].every((path) => typeof path === 'string' && isAbsolute(path)))
    throw new Error('Entry, output and notices paths must be absolute.');
  if (!existsSync(entry)) throw new Error('Consumer entry is missing.');
  if (!existsSync(noticesFile) || !statSync(noticesFile).isFile() || statSync(noticesFile).size === 0)
    throw new Error('Non-empty third-party notices file is required.');
  if (typeof version !== 'string' || version.trim() === '') throw new Error('Artifact version is required.');
  const host = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
  if (!Object.hasOwn(TARGETS, host)) throw new Error(`Unsupported native CLI host: ${host}.`);
  if (options.target !== undefined && options.target !== host)
    throw new Error(`Native CLI packaging requires matching host ${host}.`);
  await import('./qualify-koffi-gc.mjs');
  mkdirSync(dirname(outfile), { recursive: true });
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'bun',
    compile: { target: TARGETS[host], outfile },
    define: {
      __AGENT_VERSION__: JSON.stringify(version),
      __AGENT_SOURCE_VERSION__: JSON.stringify(options.sourceVersion ?? version),
      __AGENT_BUILD_METADATA__: JSON.stringify(options.buildMetadata ?? null),
    },
    plugins: [stubReactDevtools, createKoffiBunPlugin(`${process.platform}-${process.arch}`, new URL('../package.json', import.meta.url))],
  });
  if (!result.success || !existsSync(outfile))
    throw new Error(`Native CLI packaging failed: ${result.logs.map(String).join('\n')}`);
  chmodSync(outfile, 0o755);
  const noticesOutput = `${outfile}.THIRD_PARTY_NOTICES.txt`;
  copyFileSync(noticesFile, noticesOutput);
  return Object.freeze({ binary: outfile, notices: noticesOutput, target: host });
}
