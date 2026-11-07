import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

function manifests(root, family) {
  const dir = path.join(root, family);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') &&
      !['node_modules', 'dist', 'coverage'].includes(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .filter((entry) => existsSync(path.join(entry, 'package.json')));
}

export const listManifestPackageDirs = (root) => manifests(root, 'packages');
export const listWorkspacePackageDirs = (root) => [...listManifestPackageDirs(root), ...manifests(root, 'apps')];
