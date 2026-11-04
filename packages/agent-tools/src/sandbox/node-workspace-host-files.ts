import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { IWorkspaceHostFiles } from './types.js';

/**
 * The Node implementation of {@link IWorkspaceHostFiles}: a manifest's `localFile` and `localDir`
 * entries are read from the file system, a relative `src` against `root`.
 *
 * `root` is required. A caller that means the process directory says `process.cwd()` where a reader
 * can see it, as the file tools' `cwd` does.
 */
export function createNodeWorkspaceHostFiles(root: string): IWorkspaceHostFiles {
  return {
    resolve: (src) => resolve(root, src),
    readText: (path) => readFile(path, 'utf8'),
    readDirectory: async (path) => {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      }));
    },
  };
}
