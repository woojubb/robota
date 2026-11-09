import type { BigIntStats, Stats } from 'node:fs';

/**
 * Owner-only access to a store is read from POSIX mode bits and the owner uid. Windows reports an
 * emulated mode with group and other bits always set, no uid, and `chmod` there only toggles the
 * read-only attribute, so the same read would refuse every store. Owner-only access on Windows is
 * the inherited ACL of the directory the owner chose, which this package does not read; an owner
 * who places a store under a directory other accounts can write is not protected by this check.
 */
export function isOwnerOnly(stat: Stats | BigIntStats): boolean {
  if (process.platform === 'win32') return true;
  const uid = process.getuid?.();
  return (Number(stat.mode) & 0o077) === 0 && (uid === undefined || Number(stat.uid) === uid);
}

/**
 * Whether two looks at one path reached the same file or directory. Compare `BigIntStats`: a
 * Windows file index can exceed 2^53, and a rounded number would let a neighbouring file match.
 * Windows reports device 0 from `lstat` and the volume serial from `fstat` of the same file, so
 * the file index alone identifies it there.
 */
export function isSameFile(first: BigIntStats, second: BigIntStats): boolean {
  return first.ino === second.ino && (process.platform === 'win32' || first.dev === second.dev);
}
