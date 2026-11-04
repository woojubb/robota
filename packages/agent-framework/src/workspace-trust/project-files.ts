import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

import type { IWorkspaceProjectFiles } from './types.js';

const MEMBERS = [
  'readBytes',
  'listDirectory',
  'inspectKind',
  'createMutationBoundary',
  'createStableWriter',
] as const;

/**
 * The host's project file operations as the trust service will use them for its whole life: each is
 * read once, so a host that later swaps a member on its own object changes nothing already issued.
 * A host lacking a member is refused here, at construction, rather than at the first project read.
 */
export function snapshotProjectFiles(
  candidate: IWorkspaceProjectFiles | undefined,
): IWorkspaceProjectFiles {
  if (candidate === undefined || candidate === null || typeof candidate !== 'object') {
    throw new WorkspaceAuthorityRequiredError(
      'A workspace trust service requires `projectFiles`: the host operations that read and write ' +
        'project files under a trusted root. A host that has none builds no trust service and its ' +
        'sessions stay Restricted.',
    );
  }
  const snapshot = {} as Record<(typeof MEMBERS)[number], unknown>;
  for (const member of MEMBERS) {
    const operation: unknown = candidate[member];
    if (typeof operation !== 'function') {
      throw new WorkspaceAuthorityRequiredError(
        `A workspace trust service requires \`projectFiles.${member}\` to be a function.`,
      );
    }
    snapshot[member] = (operation as (...args: unknown[]) => unknown).bind(candidate);
  }
  return Object.freeze(snapshot) as unknown as IWorkspaceProjectFiles;
}
