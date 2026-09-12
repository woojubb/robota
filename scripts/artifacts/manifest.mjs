/** Expected output comes from emitters, never from walking the output under verification. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const FILE_MODE = 0o644;
const PERMISSION_MASK = 0o777;
const WINDOWS_WRITABLE_MASK = 0o200;
const digest = (contents) => createHash('sha256').update(contents).digest('hex');

export function validateArtifactPath(value) {
  if (
    typeof value !== 'string' ||
    /[\\:\x00-\x1f]/u.test(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`artifact: invalid manifest path ${JSON.stringify(value)}`);
  }
  return value;
}

export function validateManifest(value) {
  if (!value || typeof value !== 'object' || value.version !== 1 || !Array.isArray(value.files)) {
    throw new Error('artifact: invalid manifest envelope');
  }
  const seen = new Set();
  for (const record of value.files) {
    if (!record || typeof record !== 'object') throw new Error('artifact: invalid manifest record');
    validateArtifactPath(record.path);
    if (
      typeof record.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(record.sha256) ||
      ![FILE_MODE, 0o755, 0o777].includes(record.mode)
    ) {
      throw new Error(`artifact: invalid manifest digest or mode: ${record.path}`);
    }
    const key = record.path.toLowerCase();
    if (seen.has(key)) throw new Error(`artifact: duplicate manifest path ${record.path}`);
    seen.add(key);
  }
  return value;
}

export function createManifest(records) {
  return validateManifest({
    version: 1,
    files: records
      .map((record) => ({
        path: record.path,
        sha256: digest(record.contents),
        mode: record.mode ?? FILE_MODE,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  });
}

function walkFiles(root, prefix = '') {
  return readdirSync(root).flatMap((name) => {
    const relative = prefix ? `${prefix}/${name}` : name;
    const absolute = path.join(root, name);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`artifact: internal symlink ${relative}`);
    if (!stat.isDirectory() && !stat.isFile())
      throw new Error(`artifact: special file ${relative}`);
    return stat.isDirectory() ? walkFiles(absolute, relative) : [{ path: relative, absolute }];
  });
}

export function verifyManifest(root, manifest, { platform = process.platform } = {}) {
  validateManifest(manifest);
  if (!lstatSync(root).isDirectory())
    throw new Error('artifact: verification requires a physical directory');
  const expected = new Map(manifest.files.map((file) => [file.path, file]));
  for (const file of walkFiles(root)) {
    const record = expected.get(file.path);
    if (!record) throw new Error(`artifact: unexpected file ${file.path}`);
    if (digest(readFileSync(file.absolute)) !== record.sha256) {
      throw new Error(`artifact: content mismatch ${file.path}`);
    }
    // Node on Windows exposes the writable bit, not POSIX owner/group/executable distinctions.
    // Preserve full portable modes in the oracle: tar validation still checks them exactly.
    const mask = platform === 'win32' ? WINDOWS_WRITABLE_MASK : PERMISSION_MASK;
    if ((lstatSync(file.absolute).mode & mask) !== (record.mode & mask)) {
      throw new Error(`artifact: mode mismatch ${file.path}`);
    }
    expected.delete(file.path);
  }
  if (expected.size > 0) throw new Error(`artifact: missing file ${expected.keys().next().value}`);
}
