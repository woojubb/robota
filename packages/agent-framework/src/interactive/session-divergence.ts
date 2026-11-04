/**
 * What a running session does when it can no longer save its own record (#3679 step 3e).
 *
 * The store refuses to save a claimed id over a file something it cannot verify changed, and must:
 * merging it would hand the session content nobody vouched for, and overwriting it would destroy what
 * may be another of the owner's processes' newer work. The live work is not lost either: it is saved
 * once, as a new record of the owner's, and the person is told which id holds it. The same happens
 * when the session ends while a save the locked keys stood in the way of is still refused, since no
 * unlock will come for it then. The session's logs and transcripts stay keyed by its own id, which is
 * why this is one copy and not a move of the running session.
 */

import { createSessionId } from '../assembly/create-session.js';
import { uniqueSessionName } from './interactive-session-fork-record.js';
import { saveSessionCopy } from './interactive-session-persistence.js';

import type { ISessionStateForSave } from './interactive-session-persistence.js';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';
import type { Session } from '@robota-sdk/agent-session';

/**
 * Why a session stopped saving its id: `changed`, something it cannot verify changed the file;
 * `locked`, it ended while the locked keys still could not open the file.
 */
export type TSessionDivergence = 'changed' | 'locked';

/** Where the state up to now went: the new id, or that the write failed (`retry-at-end`: it is tried once more). */
export type TDivergedCopy = string | 'failed' | 'retry-at-end';

function divergedMessage(sessionId: string, why: TSessionDivergence, copy: TDivergedCopy): string {
  const head =
    why === 'changed'
      ? `Session ${sessionId} was changed on disk by something this process cannot verify, so it ` +
        'is no longer saved.'
      : `Session ${sessionId} ended while the locked keys could not open its file, so its last ` +
        'turns were not saved to it.';
  const middle =
    copy === 'failed'
      ? ' Its state up to now could not be saved as a new session either.'
      : copy === 'retry-at-end'
        ? ' Its state up to now could not be saved as a new session either; that is tried again ' +
          'when the session ends.'
        : ` Its state up to now is saved as session ${copy}; resume that id to continue.`;
  const tail =
    why === 'changed' ? ' The changed file was left as it is.' : ' The file was left as it is.';
  return `${head}${middle}${tail}`;
}

/** The notice a session gives when it stops saving its id. Fixed text and ids only. */
export class SessionDivergedError extends Error {
  readonly code = 'SESSION_DIVERGED' as const;
  readonly sessionId: string;
  readonly divergence: TSessionDivergence;
  /** The new session that holds the state up to now; absent while that write has failed. */
  readonly copyId: string | undefined;

  constructor(sessionId: string, divergence: TSessionDivergence, copy: TDivergedCopy) {
    super(divergedMessage(sessionId, divergence, copy));
    this.name = 'SessionDivergedError';
    this.sessionId = sessionId;
    this.divergence = divergence;
    this.copyId = copy === 'failed' || copy === 'retry-at-end' ? undefined : copy;
  }
}

/** Why a save that must be durable cannot be made: the session no longer saves its id. */
export class SessionNoLongerSavedError extends Error {
  readonly code = 'SESSION_NO_LONGER_SAVED' as const;
  readonly sessionId: string;

  constructor(sessionId: string, why: 'ended' | 'diverged') {
    super(
      why === 'ended'
        ? `Session ${sessionId} has ended, so nothing more is saved for it.`
        : `Session ${sessionId} is no longer saved: it was changed on disk by something this ` +
            'process cannot verify.',
    );
    this.name = 'SessionNoLongerSavedError';
    this.sessionId = sessionId;
  }
}

/**
 * Saves the live session's whole state once as a new record — an ordinary save of the owner's
 * content, never a handoff — under a name no other record answers to, and returns its id. Throws
 * whatever the store threw when it refused that write.
 */
export function saveCopyOfDivergedSession(input: {
  readonly store: IInteractiveSessionStore;
  readonly session: Session;
  readonly sessionId: string;
  readonly state: ISessionStateForSave;
}): string {
  const copyId = createSessionId();
  const name = uniqueSessionName(
    input.state.sessionName ?? input.sessionId,
    input.store,
    'copy',
    true,
  );
  saveSessionCopy(input.store, input.session, { id: copyId, name }, input.state);
  return copyId;
}
