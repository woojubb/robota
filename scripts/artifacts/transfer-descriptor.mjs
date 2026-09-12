/** Plan membership and transport metadata; no compiler or publication side effects. */
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { GENERATION_DIRECTORY } from './generation.mjs';
import { createManifest, validateArtifactPath, validateManifest } from './manifest.mjs';

export function selectTransferPackages(plan, graph) {
  if (!plan || plan.operation !== 'build' || !['global', 'packages', 'none'].includes(plan.mode)) {
    throw new Error('transfer: expected a build plan with global, packages or none mode');
  }
  if (plan.mode === 'none') return [];
  const byName = new Map(graph.packages.map((item) => [item.name, item]));
  if (plan.mode === 'global') return graph.packages.filter((item) => item.artifact);
  if (!Array.isArray(plan.packages))
    throw new Error('transfer: build plan packages must be an array');
  const selected = plan.packages.map((item) => {
    const found = byName.get(item?.name);
    if (!found) throw new Error(`transfer: unknown planned package ${item?.name}`);
    return found;
  });
  if (new Set(selected.map((item) => item.name)).size !== selected.length) {
    throw new Error('transfer: duplicate planned package');
  }
  return selected.filter((item) => item.artifact);
}

export function transferPackageRoot(root, directory) {
  validateArtifactPath(directory);
  const parts = directory.split('/');
  for (let index = 1; index <= parts.length; index++) {
    if (!lstatSync(path.join(root, ...parts.slice(0, index))).isDirectory()) {
      throw new Error(`transfer: physical workspace directory required: ${directory}`);
    }
  }
  return path.join(root, directory);
}

export function validateTransferDescriptor(value, graph) {
  if (!value || value.version !== 1 || !Array.isArray(value.packages)) {
    throw new Error('transfer: invalid descriptor envelope');
  }
  const seen = new Set();
  for (const item of value.packages) {
    const workspace = graph.packages.find((entry) => entry.name === item?.name);
    if (!workspace?.artifact || workspace.directory !== item.directory || seen.has(item.name)) {
      throw new Error(`transfer: unknown, duplicate or mismatched workspace ${item?.name}`);
    }
    seen.add(item.name);
    validateArtifactPath(item.directory);
    if (
      typeof item.sourceId !== 'string' ||
      !/^[a-f0-9-]{36}$/u.test(item.sourceId) ||
      item.link?.path !== 'dist' ||
      item.link?.target !== `${GENERATION_DIRECTORY}/${item.sourceId}/dist`
    ) {
      throw new Error(`transfer: invalid managed descriptor for ${item.name}`);
    }
    validateManifest(item.manifest);
  }
  return value;
}

export function transferExpectedFiles(descriptor, descriptorBytes) {
  const metadata = [{ path: 'transfer.json', contents: descriptorBytes }];
  const payloads = descriptor.packages.flatMap((item, index) => {
    metadata.push({
      path: `entries/${index}/manifest.json`,
      contents: JSON.stringify(item.manifest),
    });
    return item.manifest.files.map((file) => ({
      ...file,
      path: `entries/${index}/dist/${file.path}`,
    }));
  });
  return validateManifest({ version: 1, files: [...createManifest(metadata).files, ...payloads] })
    .files;
}
