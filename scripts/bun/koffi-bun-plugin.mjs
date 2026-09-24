import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const NATIVE_PACKAGES = Object.freeze({
  'darwin-arm64': '@koromix/koffi-darwin-arm64',
  'darwin-x64': '@koromix/koffi-darwin-x64',
  'linux-arm64': '@koromix/koffi-linux-arm64',
  'linux-x64': '@koromix/koffi-linux-x64',
  'win32-x64': '@koromix/koffi-win32-x64',
});

const NATIVE_TRIPLETS = Object.freeze({
  'darwin-arm64': 'darwin_arm64',
  'darwin-x64': 'darwin_x64',
  'linux-arm64': 'linux_arm64',
  'linux-x64': 'linux_x64',
  'win32-x64': 'win32_x64',
});

const NAMED_EXPORTS = [
  'Union',
  'address',
  'alias',
  'alloc',
  'array',
  'call',
  'config',
  'decode',
  'disposable',
  'encode',
  'enumeration',
  'errno',
  'extension',
  'free',
  'inout',
  'load',
  'node',
  'opaque',
  'os',
  'out',
  'pack',
  'pointer',
  'proto',
  'register',
  'reset',
  'stats',
  'struct',
  'type',
  'types',
  'union',
  'unregister',
  'version',
  'view',
];

function hostKey() {
  return `${process.platform}-${process.arch}`;
}

function nativeEntryForHost(key, resolverUrl) {
  const packageName = NATIVE_PACKAGES[key];
  if (packageName === undefined) {
    throw new Error(`Koffi Bun embedding is unsupported on host ${key}.`);
  }
  const repositoryRequire = createRequire(resolverUrl);
  const koffiEntry = repositoryRequire.resolve('koffi');
  const packageEntry = createRequire(koffiEntry).resolve(packageName);
  return join(dirname(packageEntry), NATIVE_TRIPLETS[key], 'koffi.node');
}

function shimSource(nativeEntry) {
  return [
    `import native from ${JSON.stringify(nativeEntry)};`,
    `if (native.version !== '3.3.1') throw new Error('Mismatched embedded Koffi module.');`,
    'const introspect = native.type;',
    'export const sizeof = (spec) => introspect(spec).size;',
    'export const alignof = (spec) => introspect(spec).alignment;',
    'export const offsetof = (spec, name) => introspect(spec).members[name].offset;',
    ...NAMED_EXPORTS.map((name) => `export const ${name} = native.${name};`),
    'export default native;',
  ].join('\n');
}

/**
 * Bun embeds a Node-API addon only when the `.node` file is reached by a direct static require.
 * Koffi selects its optional native package through createRequire at runtime, so a standalone build
 * cannot discover it. This build-only alias resolves the already-installed matching host package to
 * one direct import; it does not alter Node resolution or permit cross-host addons.
 */
export function createKoffiBunPlugin(expectedHost = hostKey(), resolverUrl = import.meta.url) {
  const actualHost = hostKey();
  if (expectedHost !== actualHost) {
    throw new Error(
      `Koffi Bun embedding requires the native host ${expectedHost}; actual ${actualHost}.`,
    );
  }
  const nativeEntry = nativeEntryForHost(expectedHost, resolverUrl);
  return {
    name: 'embed-host-koffi-addon',
    setup(build) {
      build.onResolve({ filter: /^koffi$/ }, () => ({
        path: 'host-koffi-addon',
        namespace: 'robota-koffi',
      }));
      build.onLoad({ filter: /.*/, namespace: 'robota-koffi' }, () => ({
        contents: shimSource(nativeEntry),
        loader: 'js',
      }));
    },
  };
}

export function supportedKoffiBunHosts() {
  return Object.keys(NATIVE_PACKAGES);
}
