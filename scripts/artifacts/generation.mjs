/** Package-local immutable outputs. Only the dist pointer changes at publication. */
import { randomUUID } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { validateManifest, verifyManifest } from './manifest.mjs';
import { GENERATION_DIRECTORY, validateOutputName, withArtifactLock } from './writer-lock.mjs';
import { publishGeneration } from './publication.mjs';

export { GENERATION_DIRECTORY } from './writer-lock.mjs';

function ownedGeneration(owner, target) {
  const root = path.resolve(owner, target);
  const parts = path.relative(owner, root).split(path.sep);
  if (
    parts.length !== 3 ||
    parts[0] !== GENERATION_DIRECTORY ||
    parts[2] !== 'dist' ||
    !/^[a-f0-9-]{36}$/u.test(parts[1])
  ) {
    throw new Error(`artifact: dist target is not a package-owned generation: ${target}`);
  }
  for (let index = 1; index <= parts.length; index++) {
    const directory = path.join(owner, ...parts.slice(0, index));
    if (!lstatSync(directory).isDirectory())
      throw new Error(`artifact: owned directory required: ${directory}`);
  }
  return root;
}

export function pinGeneration(packageRoot, options = {}) {
  const owner = realpathSync(packageRoot);
  const target = readlinkSync(path.join(owner, validateOutputName(options.outputName)));
  const root = ownedGeneration(owner, target);
  const manifest = validateManifest(
    JSON.parse(readFileSync(path.join(root, '../manifest.json'), 'utf8')),
  );
  verifyManifest(root, manifest);
  return { root, manifest, id: path.basename(path.dirname(root)) };
}

export async function assembleGeneration(packageRoot, emit, options = {}) {
  validateOutputName(options.outputName);
  const owner = realpathSync(packageRoot);
  return withArtifactLock(owner, () => stageAndPublish(owner, emit, options));
}

async function stageAndPublish(owner, emit, options) {
  const id = randomUUID();
  const directory = path.join(owner, GENERATION_DIRECTORY, id);
  const outputRoot = path.join(directory, 'dist');
  mkdirSync(outputRoot, { recursive: true });
  const manifest = await emit({ outputRoot });
  verifyManifest(outputRoot, manifest);
  writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  const generation = { root: outputRoot, manifest, id };
  publishGeneration(owner, generation, options);
  return generation;
}
