import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { createWorkspaceProjectReader } from '../workspace-trust/project-reader.js';

import type { IContributionSource } from './contribution-source.js';
import type {
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceProjectReader,
} from '../workspace-trust/index.js';

/** Explicit root-bounded adapter for host-owned contribution content. */
export function createNodeHostContributionSource(root: string): IContributionSource {
  if (root.trim().length === 0) {
    throw new Error('Node host contribution root must not be empty.');
  }
  const resolvedRoot = resolve(root);
  let reader: IWorkspaceProjectReader | undefined;

  function getReader(): IWorkspaceProjectReader | undefined {
    if (reader !== undefined) return reader;
    let canonicalRoot: string;
    try {
      canonicalRoot = realpathSync(resolvedRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    const identity: IWorkspaceIdentity = Object.freeze({
      repositoryKey: `node-host:${canonicalRoot}`,
      displayPath: canonicalRoot,
      worktreeRoot: canonicalRoot,
    });
    const identityResolver: IWorkspaceIdentityResolver = {
      resolve: () => identity,
    };
    reader = createWorkspaceProjectReader(identity, identityResolver, () => {});
    return reader;
  }

  return Object.freeze({
    kind: 'host' as const,
    displayName: resolvedRoot,
    readText: (relativePath: string, purpose: string) =>
      getReader()?.readText(relativePath, purpose),
    listDirectory: (relativePath: string, purpose: string) =>
      getReader()?.listDirectory(relativePath, purpose) ?? [],
    inspectKind: (relativePath: string, purpose: string) =>
      getReader()?.inspectKind(relativePath, purpose),
  });
}
