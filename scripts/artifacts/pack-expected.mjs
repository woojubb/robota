/** Independent expectations for the repository's pinned pnpm public pack contract. */
const RELEASE_HOOKS = new Set([
  'prepublishOnly',
  'prepack',
  'prepare',
  'postpack',
  'publish',
  'postpublish',
]);
export const PACK_DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const PACK_PUBLISH_CONFIG = new Set(['access', 'registry', 'tag', 'provenance', 'executableFiles']);

function assertSupportedManifest(original) {
  for (const key of Object.keys(original.publishConfig ?? {})) {
    if (!PACK_PUBLISH_CONFIG.has(key)) throw new Error(`pack: unsupported publishConfig.${key}`);
  }
  for (const field of ['bundleDependencies', 'bundledDependencies']) {
    const value = original[field];
    if (value && (!Array.isArray(value) || value.length > 0))
      throw new Error(`pack: unsupported ${field}`);
  }
  if (original.directories !== undefined)
    throw new Error('pack: unsupported directories inclusion');
}

export function expectedPublishManifest(original, workspaceVersions) {
  assertSupportedManifest(original);
  const { pnpm: _pnpm, scripts, ...manifest } = structuredClone(original);
  if (scripts !== undefined) {
    manifest.scripts = Object.fromEntries(
      Object.entries(scripts).filter(([name]) => !RELEASE_HOOKS.has(name)),
    );
  }
  for (const field of PACK_DEPENDENCY_FIELDS) {
    if (!manifest[field]) continue;
    manifest[field] = Object.fromEntries(
      Object.entries(manifest[field]).map(([name, range]) => {
        if (typeof range !== 'string') throw new Error(`pack: invalid dependency ${name}`);
        if (!range.startsWith('workspace:')) return [name, range];
        if (!/^workspace:[*^~]$/u.test(range))
          throw new Error(`pack: unsupported workspace range ${name}: ${range}`);
        const version = workspaceVersions.get(name);
        if (
          typeof version !== 'string' ||
          !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/u.test(version)
        ) {
          throw new Error(`pack: missing or invalid workspace version: ${name}`);
        }
        return [name, `${range === 'workspace:*' ? '' : range.slice(-1)}${version}`];
      }),
    );
  }
  return manifest;
}
