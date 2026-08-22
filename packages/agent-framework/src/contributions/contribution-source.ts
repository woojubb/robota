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
}

/** Project contributions remain bound to the exact production-accepted reader instance. */
export function createWorkspaceProjectContributionSource(
  reader: IWorkspaceProjectReader,
): IContributionSource {
  const accepted = assertWorkspaceProjectReader(reader);
  return Object.freeze({
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
