import { join } from 'node:path';

import { assertWorkspaceProjectReader } from '../workspace-trust/index.js';

import type {
  IWorkspaceDirectoryEntry,
  IWorkspaceProjectReader,
  TWorkspaceContributionKind,
} from '../workspace-trust/index.js';

export interface IContributionSource {
  readonly kind: 'host' | 'project';
  readonly displayName: string;
  readText(relativePath: string, purpose: string): string | undefined;
  listDirectory(relativePath: string, purpose: string): readonly IWorkspaceDirectoryEntry[];
  inspectKind(relativePath: string, purpose: string): TWorkspaceContributionKind | undefined;
  /**
   * The absolute path a root-relative path names, for text that must point at it (a skill's own
   * directory). Reading still goes through this source. Absent when the source cannot name one.
   */
  locate?(relativePath: string): string;
}

/** Project contributions remain bound to the exact production-accepted reader instance. */
export function createWorkspaceProjectContributionSource(
  reader: IWorkspaceProjectReader,
  root?: string,
): IContributionSource {
  const accepted = assertWorkspaceProjectReader(reader);
  return Object.freeze({
    ...(root !== undefined ? { locate: (relativePath: string) => join(root, relativePath) } : {}),
    kind: 'project' as const,
    displayName: 'authorized workspace project',
    readText: (relativePath: string, purpose: string) =>
      assertWorkspaceProjectReader(accepted).readText(relativePath, purpose),
    listDirectory: (relativePath: string, purpose: string) =>
      assertWorkspaceProjectReader(accepted).listDirectory(relativePath, purpose),
    inspectKind: (relativePath: string, purpose: string) =>
      assertWorkspaceProjectReader(accepted).inspectKind(relativePath, purpose),
  });
}
