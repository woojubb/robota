#!/usr/bin/env node
/** One package lock, one verified physical generation, one verified public pnpm tarball. */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinGeneration } from './generation.mjs';
import { materializePackImage } from './pack-image.mjs';
import { verifyPackedTarball } from './pack-tar.mjs';
import { GENERATION_DIRECTORY, withArtifactLock } from './writer-lock.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function runPnpm(args, options) {
  const cli = process.env.npm_execpath;
  if (cli && /[/\\]pnpm\.(?:c?js|mjs)$/u.test(cli)) {
    return execFileSync(process.execPath, [cli, ...args], options);
  }
  if (process.platform === 'win32') {
    throw new Error(
      'pack: on Windows invoke this entrypoint from a pnpm package script (npm_execpath must identify the public pnpm CLI)',
    );
  }
  return execFileSync('pnpm', args, options);
}

function checkPnpm(workspaceRoot, run) {
  const { packageManager } = JSON.parse(
    readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8'),
  );
  const pinnedVersion = /^pnpm@(\d+\.\d+\.\d+)$/u.exec(packageManager ?? '')?.[1];
  if (!pinnedVersion) throw new Error(`pack: unsupported packageManager ${packageManager}`);
  const version = run(['--version'], { cwd: workspaceRoot, encoding: 'utf8' }).trim();
  if (version !== pinnedVersion)
    throw new Error(`pack: pnpm version mismatch: expected ${pinnedVersion}, got ${version}`);
}

function tarballName(manifest) {
  if (
    !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(manifest.name ?? '') ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/u.test(manifest.version ?? '')
  ) {
    throw new Error('pack: invalid package name or version');
  }
  return `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`;
}

function packDestination(destination) {
  let ancestor = path.resolve(destination);
  const missing = [];
  while (!existsSync(ancestor)) {
    missing.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  const physical = path.join(realpathSync(ancestor), ...missing);
  if (physical.split(path.sep).includes(GENERATION_DIRECTORY)) {
    throw new Error('pack: destination must be outside managed generation storage');
  }
  return physical;
}

function runImagePack(imageRoot, archiveRoot, workspaceRoot, run) {
  run(
    [
      '--dir',
      imageRoot,
      'pack',
      '--pack-destination',
      archiveRoot,
      '--config.ignore-scripts=true',
      '--config.embed-readme=false',
    ],
    { cwd: workspaceRoot, encoding: 'utf8' },
  );
}

/** destination receives a NEW file only. Callers publish this exact path, never re-pack a directory. */
export async function packVerifiedPackage(
  packageRoot,
  { destination, workspaceRoot = REPO_ROOT, workspaceVersions, run = runPnpm } = {},
) {
  if (!destination) throw new Error('pack: destination is required');
  const outputDirectory = packDestination(destination);
  const owner = realpathSync(packageRoot);
  checkPnpm(workspaceRoot, run);
  return withArtifactLock(owner, async (store) => {
    const pinned = pinGeneration(owner);
    const work = path.join(store, `pack-${randomUUID()}`);
    mkdirSync(work);
    try {
      const imageRoot = path.join(work, 'package');
      const image = materializePackImage({
        packageRoot: owner,
        imageRoot,
        pinned,
        workspaceRoot,
        workspaceVersions,
      });
      const name = tarballName(image.manifest);
      const archiveRoot = path.join(work, 'archive');
      runImagePack(imageRoot, archiveRoot, workspaceRoot, run);
      const source = path.join(archiveRoot, name);
      const verified = await verifyPackedTarball(source, image.expectedFiles, {
        expectedPackageJson: image.manifest,
      });
      mkdirSync(outputDirectory, { recursive: true });
      const tarballPath = path.join(outputDirectory, name);
      copyFileSync(source, tarballPath, constants.COPYFILE_EXCL);
      const copiedHash = createHash('sha256').update(readFileSync(tarballPath)).digest('hex');
      if (copiedHash !== verified.sha256) {
        rmSync(tarballPath);
        throw new Error('pack: tarball changed during handoff');
      }
      return {
        packageName: image.manifest.name,
        version: image.manifest.version,
        generationId: pinned.id,
        tarballPath,
        ...verified,
      };
    } finally {
      rmSync(work, { recursive: true });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--package' || args[2] !== '--destination') {
      throw new Error('usage: pack.mjs --package <directory> --destination <directory>');
    }
    const result = await packVerifiedPackage(path.resolve(args[1]), {
      destination: path.resolve(args[3]),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`artifact pack: FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}
