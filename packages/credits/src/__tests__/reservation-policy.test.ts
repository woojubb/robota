import { describe, expect, it } from 'vitest';
import type { ICreditAccount, ICreditReservation } from '../types.js';
import {
  canReserveCredits,
  getAvailableCreditUnits,
  releaseReservation,
  reserveCredits,
  settleReservation,
} from '../reservation-policy.js';

function createAccount(overrides: Partial<ICreditAccount> = {}): ICreditAccount {
  return {
    accountId: 'account-1',
    ownerPrincipalId: 'principal-1',
    balanceUnits: 100,
    reservedUnits: 10,
    status: 'active',
    updatedAt: '2026-05-05T00:00:00.000Z',
    ...overrides,
  };
}

function createReservation(overrides: Partial<ICreditReservation> = {}): ICreditReservation {
  return {
    reservationId: 'reservation-1',
    accountId: 'account-1',
    units: 25,
    status: 'reserved',
    reason: 'workflow-run',
    createdAt: '2026-05-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('credit reservation policy', () => {
  it('calculates available units from balance minus active reservations', () => {
    expect(getAvailableCreditUnits(createAccount())).toBe(90);
  });

  it('allows reservations when the account is active and balance is sufficient', () => {
    const decision = canReserveCredits(createAccount(), 40);

    expect(decision).toEqual({ allowed: true, availableUnits: 90, requiredUnits: 40 });
  });

  it('denies reservations that exceed available units', () => {
    const decision = canReserveCredits(createAccount(), 120);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('CREDIT_BALANCE_INSUFFICIENT');
  });

  it('adds reserved units when a reservation is accepted', () => {
    const result = reserveCredits(createAccount(), createReservation({ units: 25 }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reservedUnits).toBe(35);
    }
  });

  it('settles a reservation by decrementing balance and clearing the reservation hold', () => {
    const result = settleReservation(createAccount(), createReservation({ units: 25 }), 20);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.balanceUnits).toBe(80);
      expect(result.value.reservedUnits).toBe(0);
    }
  });

  it('rejects settlement above reserved units', () => {
    const result = settleReservation(createAccount(), createReservation({ units: 25 }), 30);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CREDIT_SETTLEMENT_EXCEEDS_RESERVATION');
    }
  });

  it('releases a reservation without decrementing balance', () => {
    const result = releaseReservation(createAccount(), createReservation({ units: 25 }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.balanceUnits).toBe(100);
      expect(result.value.reservedUnits).toBe(0);
    }
  });
});
