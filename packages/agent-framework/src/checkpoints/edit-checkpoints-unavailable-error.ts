import { WorkspaceAuthorityRequiredError } from '../workspace-trust/index.js';

/**
 * Why a session has no edit checkpoints. A host that names its own commands (a trust command, say)
 * maps the reason to that guidance; the messages below name none.
 */
export type TEditCheckpointsUnavailableReason =
  'host-cannot-write-project' | 'restricted-workspace' | 'no-checkpoint-store';

const MESSAGES: Record<TEditCheckpointsUnavailableReason, string> = {
  'host-cannot-write-project':
    'Edit checkpoints are off on this host: it cannot prove a write stays inside the project, so a ' +
    'checkpoint could be neither saved nor restored.',
  'restricted-workspace':
    'Edit checkpoints need a trusted workspace; this one is restricted, so nothing is saved under it.',
  'no-checkpoint-store':
    'Edit checkpoints are off: this session was built without a checkpoint store.',
};

/** Thrown by a checkpoint operation on a session that has no checkpoint store. */
export class EditCheckpointsUnavailableError extends WorkspaceAuthorityRequiredError {
  constructor(readonly reason: TEditCheckpointsUnavailableReason) {
    super(MESSAGES[reason]);
  }
}
