/** Inspect bytes, never extract an archive and then trust the extracted inventory. */
import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { createReadStream, lstatSync } from 'node:fs';
import { Parser } from 'tar';
import { validateManifest } from './manifest.mjs';
import { PACK_DEPENDENCY_FIELDS } from './pack-expected.mjs';

const MAX_PACKAGE_JSON_BYTES = 4 * 1024 * 1024;

function matchesPackageJson(chunks, expected) {
  const bytes = Buffer.concat(chunks);
  if (!isUtf8(bytes)) throw new Error('pack: invalid UTF-8 package.json');
  const actual = JSON.parse(bytes.toString('utf8'));
  if (!bytes.equals(Buffer.from(JSON.stringify(actual, null, 2)))) {
    throw new Error('pack: invalid pnpm package.json serialization or duplicate keys');
  }
  // ONLY dependency-map key order is asynchronous in pnpm. exports/imports condition order,
  // arrays, every metadata value and the public serializer contract remain exact.
  return (
    JSON.stringify(orderedDependencies(actual)) === JSON.stringify(orderedDependencies(expected))
  );
}

function orderedDependencies(value) {
  const result = structuredClone(value);
  for (const field of PACK_DEPENDENCY_FIELDS) {
    const dependencies = result[field];
    if (dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)) {
      result[field] = Object.fromEntries(
        Object.keys(dependencies)
          .sort()
          .map((key) => [key, dependencies[key]]),
      );
    }
  }
  return result;
}

export async function verifyPackedTarball(
  tarballPath,
  expectedFiles,
  { expectedPackageJson } = {},
) {
  validateManifest({ version: 1, files: expectedFiles });
  if (!lstatSync(tarballPath).isFile()) throw new Error('pack: tarball must be a regular file');
  const remaining = new Map(expectedFiles.map((record) => [`package/${record.path}`, record]));
  const files = [];
  const archiveHash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const parser = new Parser({ strict: true });
    const input = createReadStream(tarballPath);
    const fail = (error) => {
      input.destroy();
      reject(error);
    };
    parser.on('error', fail);
    input.on('error', fail);
    input.on('data', (chunk) => archiveHash.update(chunk));
    parser.on('entry', (entry) => {
      const record = remaining.get(entry.path);
      if (entry.type !== 'File' || !record) {
        fail(new Error(`pack: unexpected or duplicate tar entry ${entry.path} (${entry.type})`));
        entry.resume();
        return;
      }
      remaining.delete(entry.path);
      const contentHash = createHash('sha256');
      const compareJson = record.path === 'package.json' && expectedPackageJson !== undefined;
      if (compareJson && entry.size > MAX_PACKAGE_JSON_BYTES) {
        fail(new Error('pack: package.json exceeds metadata size limit'));
        entry.resume();
        return;
      }
      const chunks = [];
      entry.on('data', (chunk) => {
        contentHash.update(chunk);
        if (compareJson) chunks.push(chunk);
      });
      entry.on('error', fail);
      entry.on('end', () => {
        try {
          const sha256 = contentHash.digest('hex');
          if (entry.mode !== record.mode) throw new Error(`pack: mode mismatch ${record.path}`);
          if (
            compareJson
              ? !matchesPackageJson(chunks, expectedPackageJson)
              : sha256 !== record.sha256
          ) {
            throw new Error(`pack: content mismatch ${record.path}`);
          }
          files.push({ ...record, sha256 });
        } catch (error) {
          fail(error);
        }
      });
      entry.resume();
    });
    parser.on('end', () => {
      if (remaining.size)
        fail(new Error(`pack: missing tar entry ${remaining.keys().next().value}`));
      else resolve();
    });
    input.pipe(parser);
  });
  return {
    sha256: archiveHash.digest('hex'),
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
  };
}
