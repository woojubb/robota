import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOTS = ['apps', 'examples', 'packages'];
const SKIPPED_DIRECTORIES = new Set(['dist', 'node_modules', '.git', '.cache']);

function workspaceManifests(root) {
  const manifests = [];
  const visit = (directory) => {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const child = `${directory}/${entry.name}`;
      let packageJson;
      try {
        packageJson = JSON.parse(readFileSync(path.join(root, child, 'package.json'), 'utf8'));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      if (packageJson?.name) manifests.push({ name: packageJson.name, directory: child });
      else visit(child);
    }
  };
  for (const directory of WORKSPACE_ROOTS) visit(directory);
  return manifests;
}

/** Resolve expensive capability jobs by direct workspace ownership, without reverse fanout. */
export function resolveCapabilityReachability(files, { cwd = process.cwd() } = {}) {
  try {
    const manifests = workspaceManifests(cwd);
    const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
    if (manifests.length === 0 || byName.size !== manifests.length) {
      throw new Error('workspace graph is empty or contains duplicate package names');
    }
    const owners = new Map();
    const unknownWorkspacePaths = [];
    for (const file of files) {
      const owner = manifests
        .filter((manifest) => file.startsWith(`${manifest.directory}/`))
        .sort((left, right) => right.directory.length - left.directory.length)[0];
      if (owner) owners.set(file, owner);
      else if (/^(?:apps|examples|packages)\//u.test(file)) unknownWorkspacePaths.push(file);
    }
    if (unknownWorkspacePaths.length > 0) {
      throw new Error(`workspace owner is unknown for ${unknownWorkspacePaths.join(', ')}`);
    }

    const ownerNames = new Set([...owners.values()].map((owner) => owner.name));
    const directOwner = (...names) => names.some((name) => ownerNames.has(name));
    const windows = [...owners].some(
      ([file, owner]) =>
        ['@robota-sdk/agent-tools', '@robota-sdk/agent-executor'].includes(owner.name) &&
        /(?:^|\/)(?:[^/]*(?:shell|windows|win32|powershell)[^/]*)(?:\/|$|\.)/iu.test(file),
    );

    return {
      cli: directOwner('@robota-sdk/agent-cli', '@robota-sdk/agent-cli-web'),
      tui: directOwner('@robota-sdk/agent-transport-tui', '@robota-sdk/agent-cli'),
      examples: [...owners.values()].some((owner) => owner.directory.startsWith('examples/')),
      windows:
        windows || files.some((file) => /(^|\/)(windows|win32|powershell)(\/|\.|-)/iu.test(file)),
    };
  } catch (error) {
    return { error: `workspace capability graph is unreadable: ${error.message}` };
  }
}
