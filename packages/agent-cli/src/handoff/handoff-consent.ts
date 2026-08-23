/**
 * SEC-011 (issue #1865): the consent prompt at the DESTINATION.
 *
 * The source end asks its operator before it gives a session away (`/handoff`, issue #1864). This is
 * the other end: before a session arrives on THIS machine and starts running here, the person at
 * this keyboard is asked.
 *
 * ## Why both ends, and not just the source
 *
 * They are not the same question. The source is asked whether to lose the session; the destination
 * is asked whether to take on someone else's work — which means this machine's provider credential,
 * this machine's files, and this machine's shell. A grant proves the same USER authorised the
 * transfer; it does not establish that the person is sitting here right now, or that they meant
 * this machine.
 *
 * ## Denial fails closed, and so does silence
 *
 * There is exactly one way to return true, and it needs a person to have chosen it. No renderer, a
 * dismissed prompt, or anything other than the accept option all return false — and the gate turns
 * that into a refusal that never exposes the session.
 */

import type { IPeerAdmission } from '@robota-sdk/agent-interface-session-mobility';
import type { IUserInteraction } from '@robota-sdk/agent-core';

/** What the prompt needs, beyond the verified admission. */
export interface IHandoffConsentContext {
  /**
   * The interactive port, or undefined when no renderer is attached.
   *
   * Read at ASK time rather than captured, because a session can lose its renderer between being
   * configured and a transfer arriving — and a captured port would then prompt into nothing and
   * wait forever, which is a hang rather than a refusal.
   */
  readonly getUserInteraction: () => IUserInteraction | undefined;
  /** This machine's name, so the prompt can say where the session would land. */
  readonly deviceLabel: string;
}

/**
 * Build the consent callback the channel gate calls after a grant verifies.
 *
 * Takes the verified admission so the prompt names a PROVEN origin. The gate guarantees the
 * ordering; this signature is the shape that makes it impossible to ask any earlier.
 */
export function createHandoffConsent(
  context: IHandoffConsentContext,
): (admission: IPeerAdmission) => Promise<boolean> {
  return async (admission) => {
    const ask = context.getUserInteraction();
    // No human is attached. Refused, never guessed — a session that started running here because
    // nobody was present to decline it is the failure this whole step exists to prevent.
    if (ask === undefined) return false;

    const origin = admission.origin?.sessionId ?? 'another device';
    // The copy below is HUMAN-facing: it is rendered into a dialog for the person at this keyboard
    // and never reaches a model. `prompt-prose` cannot tell the two apart — its subject is
    // model-facing instruction prose in a neutral library, and it matches a description property
    // plus a second-person marker, which a consent prompt naturally has. Recorded in that scan's
    // frozen baseline by its own documented path for a reviewed prompt literal, rather than reworded
    // to dodge the marker: the sentence about the signature is what tells the reader why they are
    // being asked rather than merely warned.
    const answer = await ask.ask({
      id: `handoff-inbound:${origin}`,
      title: `Accept a session from ${origin} onto ${context.deviceLabel}?`,
      description: [
        'The transfer is signed by your user key, so it really is yours. What it means here:',
        `  - the session will run on ${context.deviceLabel}, using THIS machine's provider credential`,
        '  - its tools will act on THIS machine — its files, its shell, its processes',
        '  - the other machine becomes read-only for that session once this one confirms',
      ].join('\n'),
      options: [
        { value: 'accept', label: `Take the session onto ${context.deviceLabel}` },
        { value: 'decline', label: 'Decline' },
      ],
    });
    // One way to say yes. Everything else — a dismissal, an empty answer, an option nobody offered —
    // is a decline, because the safe reading of "I did not get a clear yes" is no.
    return answer.type === 'answer' && answer.values.includes('accept');
  };
}
