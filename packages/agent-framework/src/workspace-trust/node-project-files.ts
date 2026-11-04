import {
  createStableRootedFileReader,
  createStableRootedFileWriter,
  StableFileAuthorityError,
} from '@robota-sdk/agent-file-authority';

import {
  inspectProjectKindFromHandle,
  listProjectDirectoryFromHandle,
} from './project-reader-handle.js';
import {
  inspectPortableProjectKind,
  listPortableProjectDirectory,
} from './project-reader-portable.js';
import { createWorkspaceProjectMutationBoundary } from './project-relative-writer.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

import type { IWorkspaceProjectFiles } from './types.js';

function stableProjectReadRefusalMessage(error: StableFileAuthorityError): string {
  if (error.code === 'UNSAFE_ENTRY') {
    return 'Project file authority rejected an unsafe path entry.';
  }
  if (error.code === 'UNSUPPORTED_BACKEND') {
    return 'This host cannot provide stable root-relative project reads.';
  }
  return 'The project file could not be read through a stable root authority.';
}

function readStableBytes(
  root: string,
  segments: readonly string[],
  maxBytes: number,
): Uint8Array | 'over-budget' | undefined {
  try {
    const reader = createStableRootedFileReader(root);
    try {
      return reader.readBytes(segments, maxBytes);
    } finally {
      reader.close();
    }
  } catch (error) {
    if (error instanceof StableFileAuthorityError) {
      if (error.code === 'OVER_BUDGET') return 'over-budget';
      throw new WorkspaceAuthorityRequiredError(stableProjectReadRefusalMessage(error), error);
    }
    throw error;
  }
}

/**
 * The project file operations of a Node host: reads through `@robota-sdk/agent-file-authority`'s
 * stable rooted reader and, for a listing or a kind, the descriptor walk on Linux or the portable
 * no-follow walk elsewhere; writes through the anchored writer, which Linux alone can prove and every
 * other platform refuses. The workspace trust service takes this as `projectFiles`.
 */
export function createNodeWorkspaceProjectFiles(): IWorkspaceProjectFiles {
  const files: IWorkspaceProjectFiles = {
    readBytes: readStableBytes,
    listDirectory: (identity, identityResolver, segments) =>
      process.platform === 'linux'
        ? listProjectDirectoryFromHandle(identity, identityResolver, segments)
        : listPortableProjectDirectory(identity, identityResolver, segments),
    inspectKind: (identity, identityResolver, segments) =>
      process.platform === 'linux'
        ? inspectProjectKindFromHandle(identity, identityResolver, segments)
        : inspectPortableProjectKind(identity, identityResolver, segments),
    createMutationBoundary: createWorkspaceProjectMutationBoundary,
    createStableWriter: createStableRootedFileWriter,
  };
  return Object.freeze(files);
}
