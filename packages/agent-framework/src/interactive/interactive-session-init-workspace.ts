/**
 * Workspace/sandbox bootstrap helpers for interactive session initialization
 * (split from interactive-session-init.ts).
 */

import { applyWorkspaceManifest } from '@robota-sdk/agent-tools';

import type { IInteractiveSessionStandardOptions } from './interactive-session-options.js';
import type { IInitOptions } from './interactive-session-options.js';

/**
 * The sandbox pair, carried TOGETHER onto the init options.
 *
 * ARCH-033: a client and the name a child uses to rebuild one like it are two halves of one
 * capability — a snapshot with no registered type is a reference nothing opens, and a type with no
 * client rebuilds an empty sandbox. Projecting them from one place is what keeps a later edit from
 * threading one and forgetting the other, which is the shape review found on the wire type.
 */
export function interactiveSandboxOptions(
  options: Pick<
    IInteractiveSessionStandardOptions,
    'sandboxClient' | 'sandboxType' | 'workspaceManifest' | 'sandboxWorkspaceRoot'
  >,
  sandboxSnapshotId: string | undefined,
): Pick<
  IInitOptions,
  | 'sandboxClient'
  | 'sandboxType'
  | 'workspaceManifest'
  | 'sandboxWorkspaceRoot'
  | 'sandboxSnapshotId'
> {
  return {
    ...(options.sandboxClient ? { sandboxClient: options.sandboxClient } : {}),
    ...(options.sandboxType ? { sandboxType: options.sandboxType } : {}),
    ...(options.workspaceManifest ? { workspaceManifest: options.workspaceManifest } : {}),
    ...(options.sandboxWorkspaceRoot ? { sandboxWorkspaceRoot: options.sandboxWorkspaceRoot } : {}),
    ...(sandboxSnapshotId ? { sandboxSnapshotId } : {}),
  };
}

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

/**
 * The PRESET-derived session values, carried together.
 *
 * ARCH-040. Each is a field a preset resolves and the session consumes, and each was a separate
 * conditional spread in the init literal until there were four of them. Grouping them means the next
 * preset field is added in one place rather than appended to a list nobody is reading — the same
 * reason `interactiveSandboxOptions` above exists.
 *
 * A `Pick` of `IInitOptions`, which `option-reachability` reads as a declared projection of it.
 */
export function interactivePresetOptions(
  options: Pick<
    IInteractiveSessionStandardOptions,
    'temperature' | 'maxOutputTokens' | 'presetSystemPrompt'
  >,
): Pick<IInitOptions, 'temperature' | 'maxOutputTokens' | 'presetSystemPrompt'> {
  return {
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.presetSystemPrompt !== undefined
      ? { presetSystemPrompt: options.presetSystemPrompt }
      : {}),
  };
}
