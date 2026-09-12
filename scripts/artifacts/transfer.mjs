#!/usr/bin/env node
import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalTemporaryDirectory } from '../harness/canonical-temporary-directory.mjs';
import { readWorkspaceGraph } from '../harness/workspace-graph.mjs';
import { assembleGeneration, GENERATION_DIRECTORY, pinGeneration } from './generation.mjs';
import { materializeGeneration } from './generation-image.mjs';
import { verifyManifest } from './manifest.mjs';
import {
  createTransferArchive,
  extractVerifiedTransfer,
  readTransferDescriptor,
} from './transfer-archive.mjs';
import {
  selectTransferPackages,
  transferExpectedFiles,
  transferPackageRoot,
  validateTransferDescriptor,
} from './transfer-descriptor.mjs';

async function withTransferDirectory(operation) {
  const directory = mkdtempSync(path.join(canonicalTemporaryDirectory(), 'robota-transfer-'));
  try {
    return await operation(directory);
  } finally {
    rmSync(directory, { recursive: true });
  }
}

function exportDescriptor(root, plan, graph) {
  const packages = selectTransferPackages(plan, graph).map((item) => {
    const pinned = pinGeneration(transferPackageRoot(root, item.directory));
    return { item, pinned };
  });
  return {
    packages,
    descriptor: {
      version: 1,
      packages: packages.map(({ item, pinned }) => ({
        name: item.name,
        directory: item.directory,
        sourceId: pinned.id,
        link: { path: 'dist', target: `${GENERATION_DIRECTORY}/${pinned.id}/dist` },
        manifest: pinned.manifest,
      })),
    },
  };
}

export async function exportArtifacts({ root = process.cwd(), plan, archive }) {
  const owner = realpathSync(root);
  const { packages, descriptor } = exportDescriptor(owner, plan, readWorkspaceGraph(owner));
  return withTransferDirectory(async (work) => {
    mkdirSync(path.join(work, 'package'));
    const descriptorBytes = JSON.stringify(descriptor);
    writeFileSync(path.join(work, 'package/transfer.json'), descriptorBytes);
    packages.forEach(({ pinned }, index) => {
      const directory = path.join(work, 'package/entries', String(index));
      mkdirSync(directory, { recursive: true });
      materializeGeneration(pinned, path.join(directory, 'dist'));
      writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(pinned.manifest));
    });
    const expected = transferExpectedFiles(descriptor, descriptorBytes);
    const temporaryArchive = path.join(work, 'transfer.tgz');
    const verified = await createTransferArchive(work, temporaryArchive, expected);
    const destination = path.resolve(owner, archive);
    copyFileSync(temporaryArchive, destination, constants.COPYFILE_EXCL);
    return { archive: destination, packages: descriptor.packages, sha256: verified.sha256 };
  });
}

async function prepareRestore(root, archive, work) {
  const source = path.resolve(root, archive);
  if (!lstatSync(source).isFile()) throw new Error('transfer: archive must be a regular file');
  const snapshot = path.join(work, 'transfer.tgz');
  copyFileSync(source, snapshot, constants.COPYFILE_EXCL);
  const bytes = await readTransferDescriptor(snapshot);
  const descriptor = validateTransferDescriptor(
    JSON.parse(bytes.toString('utf8')),
    readWorkspaceGraph(root),
  );
  const expected = transferExpectedFiles(descriptor, bytes);
  const extracted = path.join(work, 'extracted');
  mkdirSync(extracted);
  await extractVerifiedTransfer(snapshot, extracted, expected);
  verifyManifest(path.join(extracted, 'package'), { version: 1, files: expected });
  const packages = descriptor.packages.map((item, index) => ({
    ...item,
    owner: transferPackageRoot(root, item.directory),
    pinned: {
      root: path.join(extracted, 'package/entries', String(index), 'dist'),
      manifest: item.manifest,
      id: item.sourceId,
    },
  }));
  for (const item of packages) verifyManifest(item.pinned.root, item.manifest);
  return packages;
}

export async function restoreArtifacts({ root = process.cwd(), archive }) {
  const owner = realpathSync(root);
  return withTransferDirectory(async (work) => {
    const packages = await prepareRestore(owner, archive, work);
    const restored = [];
    for (const item of packages) {
      try {
        const generation = await assembleGeneration(item.owner, async ({ outputRoot }) => {
          // Only the new, empty staging directory is removed; materialization owns creating it.
          rmdirSync(outputRoot);
          materializeGeneration(item.pinned, outputRoot);
          return item.manifest;
        });
        restored.push({ name: item.name, sourceId: item.sourceId, id: generation.id });
      } catch (error) {
        throw new Error(
          `transfer: restore failed for ${item.name}; completed=${JSON.stringify(restored)}; ${error.message}`,
          { cause: error },
        );
      }
    }
    return { packages: restored };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    let result;
    if (
      command === 'export' &&
      args.length === 4 &&
      args[0] === '--plan' &&
      args[2] === '--archive'
    ) {
      result = await exportArtifacts({
        plan: JSON.parse(readFileSync(args[1], 'utf8')),
        archive: args[3],
      });
    } else if (command === 'restore' && args.length === 2 && args[0] === '--archive') {
      result = await restoreArtifacts({ archive: args[1] });
    } else
      throw new Error(
        'usage: transfer.mjs export --plan <json> --archive <tgz> | restore --archive <tgz>',
      );
    process.stdout.write(`artifact transfer ${command}: ${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`artifact transfer failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
