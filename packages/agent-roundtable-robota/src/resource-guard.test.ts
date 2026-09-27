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

  // MUST 4 (addendum): a bare "This session, provider or tool is already held" told a host
  // NOTHING about which of possibly many leased resources collided.
  it('names the reused resource by getName() when it has one, over a bare "resource"', () => {
    const tool = { getName: () => 'WebFetch' };
    claimLease([tool]);
    expect(() => claimLease([tool])).toThrowError(/WebFetch/);
  });

  it('names the reused resource by its .name when it has no getName()', () => {
    const provider = { name: 'anthropic' };
    claimLease([provider]);
    expect(() => claimLease([provider])).toThrowError(/anthropic/);
  });

  it('falls back to a generic description for a resource with neither getName() nor name', () => {
    class Session {}
    const session = new Session();
    claimLease([session]);
    expect(() => claimLease([session])).toThrowError(/Session/);
  });

  it('never lets a broken getName() break the error message itself', () => {
    const broken = {
      getName() {
        throw new Error('boom');
      },
      name: 'fallback-name',
    };
    claimLease([broken]);
    expect(() => claimLease([broken])).toThrowError(/fallback-name/);
  });
});
