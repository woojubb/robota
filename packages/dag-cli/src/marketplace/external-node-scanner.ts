import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { IExternalNodePackage, INodePackageManifest } from '@robota-sdk/dag-core';

const ROBOTA_DAG_KEYWORD = 'robota-dag-node';
const ROBOTA_DAG_FIELD = 'robota-dag';
const SCHEMA_VERSION = '1';

function parseNodePackageManifest(robota: unknown): INodePackageManifest | undefined {
  if (typeof robota !== 'object' || robota === null) return undefined;
  const r = robota as Record<string, unknown>;
  if (r['type'] !== 'node-package') return undefined;
  if (r['schemaVersion'] !== SCHEMA_VERSION) return undefined;
  if (!Array.isArray(r['nodes'])) return undefined;
  const nodes = (r['nodes'] as unknown[]).filter(
    (n): n is INodePackageManifest['nodes'][number] =>
      typeof n === 'object' &&
      n !== null &&
      typeof (n as Record<string, unknown>)['nodeType'] === 'string' &&
      typeof (n as Record<string, unknown>)['displayName'] === 'string' &&
      typeof (n as Record<string, unknown>)['category'] === 'string',
  );
  if (nodes.length === 0) return undefined;
  return { type: 'node-package', schemaVersion: SCHEMA_VERSION, nodes };
}

async function readPackageJson(pkgDir: string): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await readFile(join(pkgDir, 'package.json'), 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    return parsed as Record<string, unknown>;
  } catch (_err) {
    // allow-fallback: unreadable package.json is silently skipped
    return undefined;
  }
}

async function readScopedPackageDirs(scopeDir: string): Promise<string[]> {
  try {
    const entries = await readdir(scopeDir);
    return entries.map((e) => join(scopeDir, e));
  } catch (_err) {
    // allow-fallback: unreadable scoped dir produces no packages
    return [];
  }
}

/** Scan a single `node_modules` directory for robota-dag-node packages. */
async function scanNodeModulesDir(nodeModulesDir: string): Promise<IExternalNodePackage[]> {
  let entries: string[];
  try {
    entries = await readdir(nodeModulesDir);
  } catch (_err) {
    // allow-fallback: missing node_modules treated as no external packages
    return [];
  }

  const packages: IExternalNodePackage[] = [];

  for (const entry of entries) {
    const pkgDirs: string[] = entry.startsWith('@')
      ? await readScopedPackageDirs(join(nodeModulesDir, entry))
      : [join(nodeModulesDir, entry)];

    for (const pkgDir of pkgDirs) {
      const pkg = await readPackageJson(pkgDir);
      if (!pkg) continue;

      const keywords = pkg['keywords'];
      const hasKeyword =
        Array.isArray(keywords) && keywords.some((k): k is string => k === ROBOTA_DAG_KEYWORD);
      if (!hasKeyword) continue;

      const manifest = parseNodePackageManifest(pkg[ROBOTA_DAG_FIELD]);
      if (!manifest) continue;

      packages.push({
        name: typeof pkg['name'] === 'string' ? pkg['name'] : entry,
        version: typeof pkg['version'] === 'string' ? pkg['version'] : 'unknown',
        description: typeof pkg['description'] === 'string' ? pkg['description'] : undefined,
        nodeManifest: manifest,
        resolvedPath: resolve(pkgDir),
      });
    }
  }

  return packages;
}

/**
 * Discover all third-party node packages installed in node_modules.
 * Searches the node_modules directory relative to each provided root.
 * Deduplicates by package name; results are sorted alphabetically.
 */
export async function discoverExternalNodePackages(
  searchRoots?: readonly string[],
): Promise<IExternalNodePackage[]> {
  const roots = searchRoots && searchRoots.length > 0 ? searchRoots : [process.cwd()];

  const seen = new Set<string>();
  const results: IExternalNodePackage[] = [];

  for (const root of roots) {
    const found = await scanNodeModulesDir(join(root, 'node_modules'));
    for (const pkg of found) {
      if (!seen.has(pkg.name)) {
        seen.add(pkg.name);
        results.push(pkg);
      }
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
