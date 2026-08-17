import { describe, expect, it } from 'vitest';

import {
  advanceHandoff,
  beginHandoff,
  commitHandoff,
  handoffOutcome,
  sourceStillOwns,
} from '../handoff-ownership.js';

import type { IHandoffCommitAck, IHandoffManifest } from '@robota-sdk/agent-interface-transport';

const MANIFEST: IHandoffManifest = {
  handoffId: 'handoff_1',
  sessionId: 'session_1',
  sourceDeviceId: 'device_source',
  destinationDeviceId: 'device_destination',
  inventory: [],
  integrity: { digest: 'abc', byteLength: 10 },
  offeredAt: 1,
};

const ACK: IHandoffCommitAck = {
  handoffId: 'handoff_1',
  destinationDeviceId: 'device_destination',
  persisted: true,
  committedAt: 2,
};

function staged() {
  const tx = beginHandoff(MANIFEST);
  advanceHandoff(tx, 'transferring');
  advanceHandoff(tx, 'staged');
  return tx;
}

describe('HANDOFF-001 — the source keeps authority until it holds the evidence (#1811)', () => {
  it('is authoritative in every phase but committed', () => {
    // The acceptance criteria in one assertion: no phase except the last takes authority away, so
    // dying anywhere earlier leaves the session owned by the machine that still has it.
    const tx = beginHandoff(MANIFEST);
    expect(sourceStillOwns(tx)).toBe(true);

    advanceHandoff(tx, 'transferring');
    expect(sourceStillOwns(tx)).toBe(true);

    advanceHandoff(tx, 'staged');
    expect(sourceStillOwns(tx)).toBe(true);

    commitHandoff(tx, ACK);
    expect(sourceStillOwns(tx)).toBe(false);
  });

  it('TC-03: a disconnect while transferring leaves the source authoritative', () => {
    const tx = beginHandoff(MANIFEST);
    advanceHandoff(tx, 'transferring');

    advanceHandoff(tx, 'abandoned', { refusal: 'timed-out', detail: 'peer disconnected' });

    expect(sourceStillOwns(tx)).toBe(true);
    expect(handoffOutcome(tx)).toEqual({
      handoffId: 'handoff_1',
      phase: 'abandoned',
      refusal: 'timed-out',
      detail: 'peer disconnected',
    });
  });

  it('TC-09: cancellation at every non-terminal phase leaves the source authoritative', () => {
    // Asserted across the phases rather than at one, because "usable and authoritative in every
    // case" is the criterion and a single spot-check would not establish it.
    for (const stop of ['offered', 'transferring', 'staged'] as const) {
      const tx = beginHandoff(MANIFEST);
      if (stop !== 'offered') advanceHandoff(tx, 'transferring');
      if (stop === 'staged') advanceHandoff(tx, 'staged');

      const result = advanceHandoff(tx, 'abandoned', { refusal: 'cancelled' });

      expect(result.accepted, stop).toBe(true);
      expect(sourceStillOwns(tx), stop).toBe(true);
    }
  });
});

describe('HANDOFF-001 — only a durable acknowledgement moves authority (#1811)', () => {
  it('TC-02: refuses an acknowledgement that does not assert persistence', () => {
    // Receipt is not persistence. A destination that crashed after receiving and before writing
    // would otherwise leave the session owned by nobody.
    const tx = staged();

    const result = commitHandoff(tx, { ...ACK, persisted: false as unknown as true });

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/durable persistence/);
    expect(sourceStillOwns(tx)).toBe(true);
  });

  it('refuses an acknowledgement belonging to another hand-off', () => {
    const tx = staged();

    const result = commitHandoff(tx, { ...ACK, handoffId: 'handoff_2' });

    expect(result.accepted).toBe(false);
    expect(sourceStillOwns(tx)).toBe(true);
  });

  it('cannot commit from a phase that never staged anything', () => {
    // Committing straight from `offered` would hand over a session whose state was never sent.
    const tx = beginHandoff(MANIFEST);

    const result = commitHandoff(tx, ACK);

    expect(result.accepted).toBe(false);
    expect(sourceStillOwns(tx)).toBe(true);
  });

  it('TC-04/TC-05: a re-delivered acknowledgement completes rather than repeating', () => {
    // The unavoidable window: the destination committed, the ack was lost, the ack arrives again.
    // Idempotent by handoffId — a second hand-off of an already-transferred session would be a
    // transfer of something the source no longer owns.
    const tx = staged();
    const first = commitHandoff(tx, ACK);
    const retry = commitHandoff(tx, ACK);

    expect(first.accepted).toBe(true);
    expect(first.duplicate).toBeUndefined();
    expect(retry.accepted).toBe(true);
    expect(retry.duplicate).toBe(true);
    expect(tx.phase).toBe('committed');
  });
});

describe('HANDOFF-001 — an illegal transition is refused, never ignored (#1811)', () => {
  it('refuses skipping the transfer', () => {
    const tx = beginHandoff(MANIFEST);

    const result = advanceHandoff(tx, 'staged');

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/cannot move to 'staged'/);
    expect(tx.phase).toBe('offered');
  });

  it('refuses to un-commit a completed transfer', () => {
    // The destination is already live. "Un-committing" would leave the session owned by nobody,
    // which is worse than either machine owning it.
    const tx = staged();
    commitHandoff(tx, ACK);

    const result = advanceHandoff(tx, 'abandoned', { refusal: 'cancelled' });

    expect(result.accepted).toBe(false);
    expect(tx.phase).toBe('committed');
  });

  it('refuses to restart an abandoned transfer', () => {
    const tx = beginHandoff(MANIFEST);
    advanceHandoff(tx, 'abandoned', { refusal: 'cancelled' });

    expect(advanceHandoff(tx, 'transferring').accepted).toBe(false);
    expect(tx.phase).toBe('abandoned');
  });

  it('leaves the phase untouched on every refusal', () => {
    // The property behind "no ambiguous ownership": a refused transition must not half-apply.
    const tx = beginHandoff(MANIFEST);
    const before = tx.phase;

    advanceHandoff(tx, 'committed');

    expect(tx.phase).toBe(before);
  });
});
