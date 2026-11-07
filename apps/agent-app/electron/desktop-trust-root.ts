import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

/** A native decision for a Git worktree root may cover a folder selected inside it. */
export function selectedFolderWithinTrustRoot(folder: string, root: string): boolean {
  try {
    const remainder = relative(realpathSync(root), realpathSync(folder));
    return remainder === '' ||
      (remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder));
  } catch { return false; }
}
