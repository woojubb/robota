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
  exports?: Record<string, unknown>;
}

const PACKAGES_DIR = fileURLToPath(new URL('../../..', import.meta.url));
/** The workspace globs that hold packages (`pnpm-workspace.yaml`: `packages/*`, `packages/dag-nodes/*`). */
const PACKAGE_ROOTS = [PACKAGES_DIR, path.join(PACKAGES_DIR, 'dag-nodes')];

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
 * The workspace packages a source run of the CLI loads: agent-cli bundles its workspace packages, so it
 * lists them as devDependencies; every other package reaches its own through dependencies.
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
        : (pkg.manifest.dependencies ?? {});
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
    expect(names).toContain('@robota-sdk/dag-core');
    expect(names).toContain('@robota-sdk/dag-node-instant-node');
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
