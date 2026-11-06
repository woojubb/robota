import { randomId } from '@robota-sdk/agent-core';
import {
  unacceptableSessionMessage,
  OWNER_SANDBOX_REVIEW_UNAVAILABLE,
  UNVERIFIED_SESSION_QUESTION,
  unverifiedSessionNotice,
} from '@robota-sdk/agent-framework';

import type { TSessionSwitch } from './types.js';
import type { IOwnerSessionDirectory, IInteractiveSessionStore, ISessionListingEntry } from '@robota-sdk/agent-interface-session';

const SAFE_LINK_SESSION_ID = /^[A-Za-z0-9._:-]{1,256}$/u;
const REFUSED = 'The session could not be resumed.';

/** The local store makes the same decision as the attached owner, with no transport authority. */
export function localPickerDecisions(
  store: IInteractiveSessionStore | undefined,
  sessions: () => readonly ISessionListingEntry[],
  switchSession: TSessionSwitch,
): IOwnerSessionDirectory {
  let pending: { readonly sessionId: string; readonly digest: string; readonly questionId: string } | undefined;
  return {
    question(sessionId) {
      pending = undefined;
      if (sessions().find((entry) => entry.id === sessionId)?.authorship !== 'unverified' || store === undefined)
        return { kind: 'open' };
      const outcome = store.load(sessionId);
      if (outcome.status !== 'valid' || outcome.authorship !== 'unverified') return { kind: 'open' };
      if (!SAFE_LINK_SESSION_ID.test(sessionId)) return { kind: 'refused', message: REFUSED };
      if (outcome.digest === undefined) return { kind: 'refused', message: unacceptableSessionMessage(sessionId) };
      const questionId = randomId();
      pending = { sessionId, digest: outcome.digest, questionId };
      return { kind: 'accept', digest: outcome.digest, questionId, notice: unverifiedSessionNotice(sessionId), question: UNVERIFIED_SESSION_QUESTION };
    },
    cancelQuestion: () => { pending = undefined; },
    openAccepted: (sessionId, digest, questionId) => {
      if (pending?.sessionId !== sessionId || pending.digest !== digest || pending.questionId !== questionId)
        throw new Error(REFUSED);
      pending = undefined;
      return switchSession(sessionId, { acceptedDigest: digest });
    },
  };
}

/** A plain host has no owner decision authority; its ordinary session switch remains unchanged. */
export function plainHostedPickerDecisions(): IOwnerSessionDirectory {
  return {
    question: () => ({ kind: 'open' }),
    cancelQuestion: () => undefined,
    openAccepted: () => { throw new Error(REFUSED); },
  };
}

/** Only fixed refusal text and a validated ID cross the owner link into terminal presentation. */
export function linkedPickerDecisions(owner: IOwnerSessionDirectory): IOwnerSessionDirectory {
  return {
    async question(sessionId) {
      if (!SAFE_LINK_SESSION_ID.test(sessionId)) return { kind: 'refused', message: REFUSED };
      const outcome = await owner.question(sessionId);
      if (outcome.kind === 'refused') return {
        kind: 'refused',
        message: outcome.message === OWNER_SANDBOX_REVIEW_UNAVAILABLE ? OWNER_SANDBOX_REVIEW_UNAVAILABLE : REFUSED,
      };
      return outcome;
    },
    cancelQuestion: () => owner.cancelQuestion(),
    openAccepted: (sessionId, digest, questionId) => owner.openAccepted(sessionId, digest, questionId),
  };
}
