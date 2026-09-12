#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readWorkspaceGraph } from '../harness/workspace-graph.mjs';
import { readArtifactCapability } from './capability.mjs';
import { emitTsdown } from './emitters-tsdown.mjs';
import { emitVite } from './emitters-vite.mjs';
import { assembleGeneration, pinGeneration } from './generation.mjs';
import { createManifest, validateManifest, verifyManifest } from './manifest.mjs';

function workspaceRoot(packageRoot) {
  let current = packageRoot;
  while (!existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`No pnpm workspace owns ${packageRoot}`);
    current = parent;
  }
  return current;
}

function pinCopies(packageRoot, copies) {
  if (copies.length === 0) return [];
  const root = workspaceRoot(packageRoot);
  const { packages } = readWorkspaceGraph(root);
  return copies.map((copy) => {
    const producer = packages.find((entry) => entry.name === copy.package);
    if (!producer) throw new Error(`Copied producer is not a workspace package: ${copy.package}`);
    const producerRoot = realpathSync(path.join(root, producer.directory));
    if (producerRoot === packageRoot)
      throw new Error('An artifact cannot copy its own prior generation');
    return { ...copy, pinned: pinGeneration(producerRoot) };
  });
}

/** Called with the owning package cwd; producers are built by the graph, never recursively here. */
export async function buildPackage(packageRoot = process.cwd(), options = {}) {
  const root = realpathSync(packageRoot);
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const capability = readArtifactCapability(manifest);
  if (!capability) throw new Error(`Package lacks robota.artifact capability: ${root}`);
  const copies = pinCopies(root, capability.copies ?? []);
  const emit = capability.builder === 'tsdown' ? emitTsdown : emitVite;
  return assembleGeneration(
    root,
    async ({ outputRoot }) => {
      const records = await emit({ packageRoot: root, outputRoot });
      const emitted = createManifest(records);
      const copied = copies.flatMap((copy) =>
        copy.pinned.manifest.files.map((file) => ({
          ...file,
          path: `${copy.target}/${file.path}`,
        })),
      );
      const expected = validateManifest({ version: 1, files: [...emitted.files, ...copied] });
      for (const copy of copies) {
        verifyManifest(copy.pinned.root, copy.pinned.manifest);
        for (const file of copy.pinned.manifest.files) {
          const destination = path.join(outputRoot, copy.target, file.path);
          mkdirSync(path.dirname(destination), { recursive: true });
          writeFileSync(destination, readFileSync(path.join(copy.pinned.root, file.path)), {
            flag: 'wx',
            mode: file.mode,
          });
          chmodSync(destination, file.mode);
        }
      }
      return expected;
    },
    options,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  buildPackage()
    .then((result) => {
      process.stdout.write(
        `artifact generation ${result.id}: ${result.manifest.files.length} files\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`artifact build failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
