import { ArtifactLockedError } from '@robota-sdk/agent-core';

import type { TArtifactLockedReason } from '@robota-sdk/agent-core';

const LOCKED_MESSAGES: Record<TArtifactLockedReason, string> = {
  locked: 'The edit checkpoints are sealed and the keys are locked; unlock to rewind.',
  'no-keys': 'The edit checkpoints are sealed; this process has no keys to open them.',
};

/**
 * A rewind read found the session's edit checkpoints sealed and could not open them now: `locked`
 * when unlocking would, `no-keys` when this process holds no keys that could. An
 * `ArtifactLockedError`, so a caller that already tells locked artifacts apart needs nothing new.
 */
export class EditCheckpointsLockedError extends ArtifactLockedError {
  constructor(reason: TArtifactLockedReason = 'locked') {
    super(reason);
    this.name = 'EditCheckpointsLockedError';
    this.message = LOCKED_MESSAGES[this.reason];
  }
}

/** Why a checkpoint is left out of a listing and refused as part of a restore: it does not open. */
export type TEditCheckpointUnreadableReason = 'damaged' | 'newer';

/**
 * A checkpoint a rewind needs does not open — damaged (or bound to another place), or sealed by a
 * newer build — so the rewind is refused, naming it, before anything in the project is written.
 * `unfinishedMigration` marks the one damage a rerun repairs: a pre-image still plain under its sealed
 * manifest, which only a migration that stopped part-way leaves (or someone imitating one).
 */
export class EditCheckpointUnreadableError extends Error {
  readonly unfinishedMigration: boolean;

  constructor(
    readonly checkpointId: string,
    readonly reason: TEditCheckpointUnreadableReason,
    options: {
      readonly part?: 'manifest' | 'pre-image';
      readonly refused?: boolean;
      readonly unfinishedMigration?: boolean;
    } = {},
  ) {
    const subject =
      options.part === 'pre-image'
        ? `A pre-image of edit checkpoint ${checkpointId}`
        : `Edit checkpoint ${checkpointId}`;
    const state =
      options.unfinishedMigration === true
        ? 'is still plain under its sealed manifest: a migration stopped part-way, and running `secure migrate` again finishes it'
        : reason === 'newer'
          ? 'was written by a newer build and does not open here'
          : 'is damaged and does not open';
    const refusal =
      options.refused === true
        ? ' Nothing was restored; restoring to a checkpoint after it still works.'
        : '';
    super(`${subject} ${state}.${refusal}`);
    this.name = 'EditCheckpointUnreadableError';
    this.unfinishedMigration = options.unfinishedMigration === true;
  }
}

/**
 * A session's checkpoints already reach the highest number a checkpoint directory can carry. No new
 * checkpoint is made: numbering never wraps around onto an earlier checkpoint's directory.
 */
export class EditCheckpointNumberingExhaustedError extends Error {
  constructor() {
    super(
      "This session's edit checkpoints have reached the highest checkpoint number, so no new checkpoint can be made.",
    );
    this.name = 'EditCheckpointNumberingExhaustedError';
  }
}
