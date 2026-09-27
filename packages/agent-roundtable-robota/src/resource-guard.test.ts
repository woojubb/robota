import { describe, expect, it } from 'vitest';
import { RobotaParticipantError } from './errors';
import { claimLease } from './resource-guard';

describe('claimLease', () => {
  it('lets a resource be claimed again once its earlier lease is released', () => {
    const provider = {};
    const release = claimLease([provider]);
    release();
    expect(() => claimLease([provider])).not.toThrow();
  });

  it('rejects reuse of a resource still held by a live lease', () => {
    const provider = {};
    claimLease([provider]);
    expect(() => claimLease([provider])).toThrow(RobotaParticipantError);
    try {
      claimLease([provider]);
      throw new Error('expected claimLease to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RobotaParticipantError);
      expect((error as RobotaParticipantError).code).toBe('resource-reused');
    }
  });

  it('claims every resource atomically: one already held rejects the whole claim', () => {
    const held = {};
    const fresh = {};
    claimLease([held]);
    expect(() => claimLease([fresh, held])).toThrow(RobotaParticipantError);
    // `fresh` must not have been left claimed by the failed attempt.
    expect(() => claimLease([fresh])).not.toThrow();
  });

  it('releasing is idempotent', () => {
    const tool = {};
    const release = claimLease([tool]);
    release();
    expect(() => release()).not.toThrow();
    expect(() => claimLease([tool])).not.toThrow();
  });
});
