import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type TProductConversationMode = 'plain' | 'preparing' | 'secure';

const MODE_FILE = 'mode.json';
const MAX_MODE_BYTES = 1024;

/** A missing first-run choice is plain; a missing choice beside secure artifacts is ambiguous. */
export function readProductConversationMode(userRoot: string): TProductConversationMode {
  const directory = join(userRoot, 'secure');
  const path = join(directory, MODE_FILE);
  const privateArea = join(userRoot, 'secure-v1');
  const marker = lstatSync(path, { throwIfNoEntry: false });
  if (marker === undefined) {
    if (lstatSync(privateArea, { throwIfNoEntry: false }) !== undefined) {
      throw new Error('Secure conversation artifacts exist without a mode choice; restore the choice before starting Robota.');
    }
    return 'plain';
  }
  const parent = lstatSync(directory, { throwIfNoEntry: false });
  if (parent === undefined || !parent.isDirectory() || !marker.isFile() || marker.nlink !== 1) {
    throw new Error('The secure conversation mode choice is not an ordinary private file.');
  }
  const uid = process.getuid?.();
  if (
    uid !== undefined &&
    (parent.uid !== uid || marker.uid !== uid || (parent.mode & 0o077) !== 0 || (marker.mode & 0o077) !== 0)
  ) {
    throw new Error('The secure conversation mode choice is not owner-only.');
  }
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() || opened.nlink !== 1 || opened.size > MAX_MODE_BYTES || opened.size === 0 ||
      opened.dev !== marker.dev || opened.ino !== marker.ino ||
      (uid !== undefined && (opened.uid !== uid || (opened.mode & 0o077) !== 0))
    ) {
      throw new Error('The secure conversation mode choice is invalid.');
    }
    const parsed: unknown = JSON.parse(readFileSync(descriptor, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('The secure conversation mode choice is invalid.');
    }
    const record = parsed as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(',') !== 'mode,schemaVersion' ||
      record.schemaVersion !== 1 ||
      (record.mode !== 'off' && record.mode !== 'preparing' && record.mode !== 'on')
    ) {
      throw new Error('The secure conversation mode choice is invalid.');
    }
    return record.mode === 'on' ? 'secure' : record.mode === 'preparing' ? 'preparing' : 'plain';
  } finally {
    closeSync(descriptor);
  }
}
