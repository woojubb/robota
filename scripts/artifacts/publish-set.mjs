/** All slow packing precedes OTP entry; retries reuse this exact prepared set. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readWorkspaceGraph } from '../harness/workspace-graph.mjs';
import { packVerifiedPackage } from './pack.mjs';

export async function prepareReleaseArtifacts({
  root,
  destination,
  packageNames,
  pack = packVerifiedPackage,
}) {
  if (!packageNames.length || new Set(packageNames).size !== packageNames.length) {
    throw new Error('artifact publish: select a nonempty unique package set');
  }
  const graph = readWorkspaceGraph(root);
  const inventory = graph.packages.map((entry) => ({
    root: path.join(root, entry.directory),
    manifest: JSON.parse(readFileSync(path.join(root, entry.directory, 'package.json'), 'utf8')),
  }));
  const selected = packageNames.map((name) => {
    const entry = inventory.find((item) => item.manifest.name === name);
    if (!entry || (entry.manifest.private !== undefined && entry.manifest.private !== false)) {
      throw new Error(`artifact publish: unknown or private package ${name}`);
    }
    return entry;
  });
  if (new Set(selected.map((entry) => entry.manifest.version)).size !== 1) {
    throw new Error('artifact publish: selected packages must share the release version');
  }
  const workspaceVersions = new Map(
    inventory.map((entry) => [entry.manifest.name, entry.manifest.version]),
  );
  const prepared = [];
  for (const entry of selected) {
    prepared.push(await pack(entry.root, { destination, workspaceRoot: root, workspaceVersions }));
  }
  return prepared;
}
