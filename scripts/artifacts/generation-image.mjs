/** Materialize a pinned generation as ordinary files; never infer expected output from this image. */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinGeneration } from './generation.mjs';
import { verifyManifest } from './manifest.mjs';

export function materializeGeneration(pinned, destination) {
  verifyManifest(pinned.root, pinned.manifest);
  mkdirSync(destination);
  for (const file of pinned.manifest.files) {
    const target = path.join(destination, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path.join(pinned.root, file.path)), {
      flag: 'wx',
      mode: file.mode,
    });
    chmodSync(target, file.mode);
  }
  verifyManifest(destination, pinned.manifest);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [owner, outputName, destination] = process.argv.slice(2);
    if (!owner || !outputName || !destination) {
      throw new Error('usage: generation-image.mjs <package> <output-name> <new-image-directory>');
    }
    const pinned = pinGeneration(owner, { outputName });
    materializeGeneration(pinned, path.resolve(destination));
    process.stdout.write(`materialized generation ${pinned.id}\n`);
  } catch (error) {
    process.stderr.write(`artifact image: ${error.message}\n`);
    process.exitCode = 1;
  }
}
