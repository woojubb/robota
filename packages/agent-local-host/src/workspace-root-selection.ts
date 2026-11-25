import { realpathSync } from 'node:fs';

import { createNodeWorkspaceIdentityResolver } from '@robota-sdk/agent-framework/node';

import type { IWorkspaceIdentity } from '@robota-sdk/agent-framework';

/** All secure clients and runtimes fence the same physical Git root, or the exact non-Git folder. */
export function secureWorkspaceRoot(cwd: string, identity?: IWorkspaceIdentity): string {
  const workspace = realpathSync(cwd);
  if (identity) return identity.worktreeRoot;
  try { return createNodeWorkspaceIdentityResolver().resolve(workspace).worktreeRoot; }
  catch { return workspace; }
}
