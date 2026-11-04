import { lstatSync } from 'node:fs';
import { join, sep } from 'node:path';

import { workspaceProjectStateDirectoryParts } from './project-state-storage.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

import type { IWorkspaceProjectStateStorage } from './types.js';

/**
 * The absolute path of directory `relativeDirectory` of `storage`, for a host mechanism that must
 * address it by path — the writer markers of a project's session store, which hard links publish. No
 * segment from the trusted root down to it may be a link or anything but a directory, since one would
 * put what is kept there outside the project; a segment not made yet ends the check, and the caller
 * makes it. Internal to the framework: it reads the file system, so it lives with the Node adapters.
 */
export function workspaceProjectStateDirectoryPath(
  storage: IWorkspaceProjectStateStorage,
  relativeDirectory: string,
): string {
  const parts = workspaceProjectStateDirectoryParts(storage, relativeDirectory);
  let current = parts.worktreeRoot;
  for (const segment of parts.relativeDirectory.split(sep).filter((part) => part.length > 0)) {
    current = join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new WorkspaceAuthorityRequiredError(
        'A project state directory is a link or not a directory, so it may lie outside the project.',
      );
    }
  }
  return join(parts.worktreeRoot, parts.relativeDirectory);
}
