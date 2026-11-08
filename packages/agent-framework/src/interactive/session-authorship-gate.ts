/**
 * The gate every resume over a store that seals passes, and the fixed words it refuses in.
 *
 * Sealing needs only the public key, so a record that opens says nothing about who wrote it. The gate
 * is keyed on the outcome the resume restores from: a record the store calls unverified is refused
 * unless it is exactly the bytes the owner accepted. Nothing a record says reaches the person before
 * they decide whether it is theirs, so every word here is fixed text and the session id.
 */

import type { TSessionLoadOutcome, TSessionProvenance } from '@robota-sdk/agent-interface/session';

/**
 * Why a claimed record was not resumed: nothing shows the owner wrote it; not the bytes they accepted;
 * or another writer holds it (a subagent it is lent to, another process), so it cannot be raised.
 */
export type TSessionAuthorshipRefusal = 'unverified' | 'changed-since-accepted' | 'has_writer';

function authorshipRefusalMessage(sessionId: string, reason: TSessionAuthorshipRefusal): string {
  switch (reason) {
    case 'unverified':
      return (
        `Cannot resume session ${sessionId}: nothing shows that you wrote it, and another program ` +
        'of your user could have.'
      );
    case 'changed-since-accepted':
      return (
        `Cannot resume session ${sessionId}: the session changed on disk after you accepted it; ` +
        'resume it again to review it.'
      );
    case 'has_writer':
      return (
        `Cannot resume session ${sessionId}: another writer holds it, such as a subagent still ` +
        'saving it; resume it once that has ended.'
      );
  }
}

/**
 * A resume refused because the record is not the owner's. Fixed text and the session id only, since
 * nothing a record says may reach the person before they decide whether it is theirs.
 */
export class SessionAuthorshipRefusedError extends Error {
  readonly code = 'SESSION_AUTHORSHIP_REFUSED' as const;
  readonly sessionId: string;
  readonly reason: TSessionAuthorshipRefusal;

  constructor(sessionId: string, reason: TSessionAuthorshipRefusal) {
    super(authorshipRefusalMessage(sessionId, reason));
    this.name = 'SessionAuthorshipRefusedError';
    this.sessionId = sessionId;
    this.reason = reason;
  }
}

/**
 * What a person is told before deciding whether an unverified record is theirs, on every surface that
 * asks: fixed text and the id only, since nothing the record says may reach them before they decide.
 */
export function unverifiedSessionNotice(sessionId: string): string {
  return (
    `Session ${sessionId} is not verified as yours: nothing shows that you wrote it, and another ` +
    'program of your user could have. Resuming it gives everything in it to the model as this ' +
    "conversation's history, and marks it as yours from then on."
  );
}

/** The question asked after {@link unverifiedSessionNotice}; no is the default. */
export const UNVERIFIED_SESSION_QUESTION = 'Resume it and mark it as yours?';

/** Fixed recovery instruction for a served review whose sandbox setup cannot be cancelled. */
export const OWNER_SANDBOX_REVIEW_UNAVAILABLE =
  'This session requires sandbox setup that cannot be cancelled while attached. ' +
  'Review it in a local interactive terminal with --resume and its session ID.';

/**
 * What a person is told of an unverified record that has no stored bytes to accept — one rebuilt
 * from its replay log — so it cannot be marked as theirs. Fixed text and the id only.
 */
export function unacceptableSessionMessage(sessionId: string): string {
  return (
    `Session ${sessionId} cannot be marked as yours: it exists only as its replay log, so there ` +
    'are no stored bytes to vouch for. Keep it as it is; it was not resumed.'
  );
}

/**
 * Whether `error` is a {@link SessionAuthorshipRefusedError}, by `code`: a package's ES and CommonJS
 * builds loaded in one process are two classes an `instanceof` cannot match across.
 */
export function isSessionAuthorshipRefusedError(
  error: unknown,
): error is SessionAuthorshipRefusedError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { readonly code?: unknown }).code === 'SESSION_AUTHORSHIP_REFUSED'
  );
}

/**
 * The provenance a writer outside a running session passes for a record it read through a hold read:
 * the owner's for a verified record, `unverified` for anything else a store that seals read, and none
 * from a store that never seals, which then gets exactly the save it always got.
 */
export function provenanceOfOutcome(outcome: TSessionLoadOutcome): TSessionProvenance | undefined {
  if (outcome.status !== 'valid' || outcome.authorship === undefined) return undefined;
  return outcome.authorship === 'verified' ? 'owner' : 'unverified';
}

/**
 * Refuses an unverified outcome without acceptance, and refuses a missing or valid outcome whose
 * bytes differ from the accepted digest, even if replacement bytes are verified. A store view cannot
 * switch the gate off. Other non-valid outcomes remain the caller's to judge.
 */
export function assertClaimedOutcomeAccepted(
  sessionId: string,
  outcome: TSessionLoadOutcome,
  acceptedDigest: string | undefined,
): void {
  if (
    acceptedDigest !== undefined &&
    (outcome.status === 'missing' ||
      (outcome.status === 'valid' && outcome.digest !== acceptedDigest))
  ) {
    throw new SessionAuthorshipRefusedError(sessionId, 'changed-since-accepted');
  }
  if (outcome.status !== 'valid') return;
  if (outcome.authorship === 'unverified' && acceptedDigest === undefined) {
    throw new SessionAuthorshipRefusedError(sessionId, 'unverified');
  }
}
