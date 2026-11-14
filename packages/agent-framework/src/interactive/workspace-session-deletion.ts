import { WorkspaceAuthorityRequiredError } from '../workspace-trust/workspace-authority-required-error.js';

import type { IWorkspaceProjectStateStorage } from '../workspace-trust/index.js';

/**
 * What a project session store removes with a deleted session besides its record, log and payloads.
 * A store given none of it deletes only the record, as a store always did.
 */
export interface IProjectSessionDeletion {
  /**
   * The `checkpoints` state facet of the same grant: a deleted session's checkpoint directory is
   * removed while the store holds that session's checkpoint writer lease.
   */
  readonly checkpoints?: IWorkspaceProjectStateStorage;
  /**
   * Removes a deleted session's subagent logs, which live under the user's log root rather than in
   * the project (`removeSubagentLogs` bound to the host's root). A throw stops the deletion before
   * the record is removed.
   */
  readonly removeSubagentLogs?: (sessionId: string) => void;
  /**
   * The sinks writing this project's session logs, told each deleted id before its log is removed so
   * nothing they still hold for it is written back, and told when the id is claimed again.
   */
  readonly logSinks?: readonly IProjectSessionLogFence[];
}

/** What a session log sink offers so a deleted session's late lines are dropped. */
export interface IProjectSessionLogFence {
  /** Drop every later line and payload for `sessionId`: the session was deleted. */
  sessionDeleted(sessionId: string): void;
  /** `sessionId` was claimed again: a session with a deleted session's id is a new one and logs anew. */
  sessionStarted(sessionId: string): void;
}

/** Why a delete stopped with the session's record still in place. */
export type TProjectSessionDeletionStop = 'checkpoint-writer' | 'incomplete-removal';

/**
 * A delete that stopped before removing the record, so the session is still listed and a later
 * delete finishes it: a checkpoint writer held the session's lease (nothing of its checkpoints was
 * touched), or a directory kept answering `partial` past the retry bound.
 */
export class ProjectSessionDeletionStoppedError extends Error {
  readonly reason: TProjectSessionDeletionStop;

  constructor(sessionId: string, reason: TProjectSessionDeletionStop) {
    super(
      reason === 'checkpoint-writer'
        ? `Session ${sessionId} was not deleted: a checkpoint writer is using it. Try again once it has finished.`
        : `Session ${sessionId} was not fully deleted: some of its files could not be removed yet. Delete it again to finish.`,
    );
    this.name = 'ProjectSessionDeletionStoppedError';
    this.reason = reason;
  }
}

/**
 * How many times one directory removal is called while it answers `partial`. Each call is bounded by
 * the boundary's own entry and time budget, so this bounds the whole wait; a directory something keeps
 * writing into is reported instead of chased forever.
 */
export const DIRECTORY_REMOVAL_ATTEMPTS = 8;

/** Removes `relativePath` of `storage` whole, or throws with the reason the record must stay. */
export function removeStateDirectory(
  storage: IWorkspaceProjectStateStorage,
  relativePath: string,
  sessionId: string,
  purpose: string,
): void {
  const remove = storage.removeDirectory?.bind(storage);
  if (remove === undefined) {
    throw new WorkspaceAuthorityRequiredError('The project host cannot remove directories.');
  }
  for (let attempt = 0; attempt < DIRECTORY_REMOVAL_ATTEMPTS; attempt += 1) {
    if (remove(relativePath, purpose).status !== 'partial') return;
  }
  throw new ProjectSessionDeletionStoppedError(sessionId, 'incomplete-removal');
}

/**
 * Removes checkpoint directory `<sessionId>` of `checkpoints`: nothing is created for a session that
 * has none; otherwise its writer lease is taken first (a held lease stops the delete with nothing
 * touched), the turn directories are removed under the lease's guard, the lease is released, and the
 * session directory goes last with the lease's `.writer` directory and its lock file in it.
 */
export function removeSessionCheckpoints(
  checkpoints: IWorkspaceProjectStateStorage,
  sessionId: string,
): void {
  const entry = checkpoints
    .listDirectory('', 'find the checkpoints of a deleted session')
    .find((candidate) => candidate.name === sessionId);
  if (entry === undefined) return;
  const purpose = 'delete the checkpoints of a deleted session';
  if (entry.kind === 'file') {
    checkpoints.deleteFile(sessionId, purpose);
    return;
  }
  if (entry.kind === 'directory') {
    if (checkpoints.acquireWriter === undefined) {
      throw new ProjectSessionDeletionStoppedError(sessionId, 'checkpoint-writer');
    }
    // The session directory exists, so taking the lease creates at most its `.writer` directory,
    // which goes with the session directory below.
    const lease = checkpoints.acquireWriter(`${sessionId}/.writer`, purpose);
    if (lease === undefined)
      throw new ProjectSessionDeletionStoppedError(sessionId, 'checkpoint-writer');
    try {
      const turns = checkpoints
        .listDirectory(sessionId, purpose)
        .filter((turn) => turn.kind === 'directory' && turn.name !== '.writer');
      for (const turn of turns) {
        const guarded = lease.withGuard(() =>
          removeStateDirectory(checkpoints, `${sessionId}/${turn.name}`, sessionId, purpose),
        );
        if (guarded.status !== 'ran') {
          throw new ProjectSessionDeletionStoppedError(sessionId, 'checkpoint-writer');
        }
      }
    } finally {
      lease.release();
    }
  }
  // A link or other entry under the name is refused here, never followed.
  removeStateDirectory(checkpoints, sessionId, sessionId, purpose);
}
