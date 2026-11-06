import { BrokeredWorkspaceTrustService } from '../../startup/brokered-workspace-trust.js';
import { runWorkspaceTrustCommand } from '../../startup/workspace-trust-command.js';

import type { ICliRuntimeContext } from '../../product/runtime-context.js';

/** Simulates the desktop's affirmative answer after the broker has pinned the candidate. */
export async function approveTestWorkspace(cwd: string, runtime: ICliRuntimeContext): Promise<number> {
  const brokered = await BrokeredWorkspaceTrustService.create(runtime);
  try {
    const candidate = await brokered.prepare(cwd);
    return await runWorkspaceTrustCommand(
      ['grant', '--yes', '--desktop-approved-candidate', candidate], cwd, runtime,
    );
  } finally {
    brokered.close();
  }
}

/** Drives the same candidate handoff that a desktop confirmation sends to a source CLI. */
export async function approveTestWorkspaceCommand<T extends { readonly stdout: string }>(
  run: (args: string[]) => T | Promise<T>,
): Promise<T> {
  const status = await run(['trust', 'status', '--json']);
  const value: unknown = JSON.parse(status.stdout);
  if (typeof value !== 'object' || value === null || !('candidate' in value) ||
      typeof value.candidate !== 'string') {
    throw new Error('The CLI did not prepare a workspace approval candidate.');
  }
  return run(['trust', 'grant', '--yes', '--desktop-approved-candidate', value.candidate]);
}
