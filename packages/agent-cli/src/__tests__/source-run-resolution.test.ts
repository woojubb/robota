/**
 * `pnpm cli:dev` runs the CLI from TypeScript source with `--conditions=source`: every workspace package
 * it reaches must resolve to `src/` through a `source` export condition. One subpath without it resolves
 * to `dist/`, and the source run then fails until the workspace is built — which is how `cli:dev` came to
 * need a build first. This walks the CLI's workspace dependency closure and checks every export subpath
 * that loads under Node.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface IManifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
}

const PACKAGES_DIR = fileURLToPath(new URL('../../..', import.meta.url));
const PACKAGE_ROOTS = [PACKAGES_DIR];

function workspaceManifests(): Map<string, { dir: string; manifest: IManifest }> {
  const byName = new Map<string, { dir: string; manifest: IManifest }>();
  for (const root of PACKAGE_ROOTS) {
    for (const entry of readdirSync(root)) {
      const file = path.join(root, entry, 'package.json');
      if (!existsSync(file)) continue;
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as IManifest;
      byName.set(manifest.name, { dir: path.join(root, entry), manifest });
    }
  }
  return byName;
}

/**
 * The workspace packages a source run of the CLI may load: agent-cli lists its workspace packages as
 * devDependencies (it bundles them); every other package reaches its own through its dependencies,
 * including optional dependencies and peer workspace dependencies.
 */
function cliClosure(
  byName: Map<string, { dir: string; manifest: IManifest }>,
): Array<{ dir: string; manifest: IManifest }> {
  const seen = new Set<string>();
  const queue = ['@robota-sdk/agent-cli'];
  while (queue.length > 0) {
    const name = queue.pop() as string;
    const pkg = byName.get(name);
    if (!pkg || seen.has(name)) continue;
    seen.add(name);
    const deps =
      name === '@robota-sdk/agent-cli'
        ? { ...pkg.manifest.dependencies, ...pkg.manifest.devDependencies }
        : {
            ...pkg.manifest.dependencies,
            ...pkg.manifest.optionalDependencies,
            ...pkg.manifest.peerDependencies,
          };
    for (const [dep, spec] of Object.entries(deps)) {
      if (spec.startsWith('workspace:')) queue.push(dep);
    }
  }
  return [...seen].map((name) => byName.get(name) as { dir: string; manifest: IManifest });
}

/** Export subpaths a Node source run can load: an object entry naming a non-browser `dist/` JavaScript file. */
function nodeSubpaths(manifest: IManifest): Array<[string, Record<string, unknown>]> {
  return Object.entries(manifest.exports ?? {}).flatMap(([subpath, entry]) =>
    entry !== null &&
    typeof entry === 'object' &&
    /"\.\/dist\/(?!browser\/)[^"]+\.c?js"/u.test(JSON.stringify(entry))
      ? [[subpath, entry as Record<string, unknown>]]
      : [],
  );
}

describe('pnpm cli:dev runs without a build', () => {
  const closure = cliClosure(workspaceManifests());

  it('reaches the workspace packages the CLI depends on', () => {
    const names = closure.map(({ manifest }) => manifest.name);
    expect(names).toContain('@robota-sdk/agent-core');
    expect(names).not.toContain('@robota-sdk/agent-command-workflows');
    expect(names.some((name) => name.startsWith('@robota-sdk/dag-'))).toBe(false);
  });

  it('resolves every reached export subpath to an existing source file', () => {
    const missing = closure.flatMap(({ dir, manifest }) =>
      nodeSubpaths(manifest)
        .filter(
          ([, entry]) =>
            typeof entry['source'] !== 'string' ||
            !existsSync(path.join(dir, entry['source'] as string)),
        )
        .map(([subpath]) => `${manifest.name} ${subpath}`),
    );

    expect(missing).toEqual([]);
  });
});
