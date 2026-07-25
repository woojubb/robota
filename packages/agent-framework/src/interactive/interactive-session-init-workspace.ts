/**
 * Workspace/sandbox bootstrap helpers for interactive session initialization
 * (split from interactive-session-init.ts).
 */

import { applyWorkspaceManifest } from '@robota-sdk/agent-tools';

import type { IInitOptions } from './interactive-session-options.js';

export async function applyInteractiveWorkspaceManifest(
  options: IInitOptions,
  cwd: string,
): Promise<void> {
  if (!options.workspaceManifest) return;
  if (!options.sandboxClient) {
    throw new Error('workspaceManifest requires sandboxClient.');
  }
  await applyWorkspaceManifest(options.sandboxClient, options.workspaceManifest, {
    hostRoot: cwd,
    ...(options.sandboxWorkspaceRoot ? { targetRoot: options.sandboxWorkspaceRoot } : {}),
  });
}

export async function restoreInteractiveSandboxSnapshot(options: IInitOptions): Promise<boolean> {
  if (!options.sandboxSnapshotId) return false;
  if (!options.sandboxClient?.restore) {
    throw new Error('sandboxSnapshotId requires sandboxClient with restore().');
  }
  await options.sandboxClient.restore(options.sandboxSnapshotId);
  return true;
}
