import { describe, expect, it } from 'vitest';

import { acceptSubmission } from '../interactive-session-accept-submission.js';

import type { SessionExecutionController } from '../interactive-session-execution-controller.js';

/** The two things `acceptSubmission` actually touches on the controller. */
function controller(): SessionExecutionController {
  return {
    turns: { begin: () => ({ turnId: 'turn_1', completed: Promise.resolve({}) }) },
    enqueuePending: () => 'queued',
  } as unknown as SessionExecutionController;
}

describe('PEER-002 — a peer turn is never attributed to the operator (#1809)', () => {
  it('refuses a peer turn that carries no driver id', () => {
    // Falling through to the owner default would put another session's message in the transcript
    // under the operator's name. There is no id we could invent here that would be true, so this
    // has to be the caller's to supply — and a default would hide that it was missing.
    expect(() => acceptSubmission({ turnSource: 'peer' }, controller())).toThrow(
      /peer turn must carry the peer driver id/,
    );
  });

  it('keeps the peer driver id when one is given', () => {
    const accepted = acceptSubmission(
      { turnSource: 'peer', driverId: 'peer:session_b' },
      controller(),
    );

    expect(accepted.driverId).toBe('peer:session_b');
  });

  it('leaves the existing user and agent-wakeup defaults untouched', () => {
    // The new branch must not be a behaviour change for the two sources that were already here.
    expect(acceptSubmission({}, controller()).driverId).toBe('owner');
    expect(acceptSubmission({ turnSource: 'agent-wakeup' }, controller()).driverId).not.toBe(
      'owner',
    );
  });
});
