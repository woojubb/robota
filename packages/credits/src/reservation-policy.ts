import type {
  ICreditAccount,
  ICreditError,
  ICreditReservation,
  ICreditReservationDecision,
  TCreditResult,
} from './types.js';

export function createCreditError(
  code: ICreditError['code'],
  message: string,
  retryable = false,
): ICreditError {
  return { code, message, retryable };
}

export function getAvailableCreditUnits(account: ICreditAccount): number {
  return account.balanceUnits - account.reservedUnits;
}

export function canReserveCredits(
  account: ICreditAccount,
  requiredUnits: number,
): ICreditReservationDecision {
  const availableUnits = getAvailableCreditUnits(account);
  if (!Number.isSafeInteger(requiredUnits) || requiredUnits <= 0) {
    return {
      allowed: false,
      availableUnits,
      requiredUnits,
      reason: 'CREDIT_AMOUNT_INVALID',
    };
  }
  if (account.status !== 'active') {
    return {
      allowed: false,
      availableUnits,
      requiredUnits,
      reason: 'CREDIT_ACCOUNT_NOT_ACTIVE',
    };
  }
  if (availableUnits < requiredUnits) {
    return {
      allowed: false,
      availableUnits,
      requiredUnits,
      reason: 'CREDIT_BALANCE_INSUFFICIENT',
    };
  }
  return { allowed: true, availableUnits, requiredUnits };
}

export function reserveCredits(
  account: ICreditAccount,
  reservation: ICreditReservation,
): TCreditResult<ICreditAccount> {
  const decision = canReserveCredits(account, reservation.units);
  if (!decision.allowed) {
    return {
      ok: false,
      error: createCreditError(
        decision.reason ?? 'CREDIT_BALANCE_INSUFFICIENT',
        `Account ${account.accountId} cannot reserve ${reservation.units} credit units`,
      ),
    };
  }
  if (reservation.status !== 'reserved') {
    return {
      ok: false,
      error: createCreditError(
        'CREDIT_RESERVATION_NOT_ACTIVE',
        `Reservation ${reservation.reservationId} is not active`,
      ),
    };
  }
  return {
    ok: true,
    value: {
      ...account,
      reservedUnits: account.reservedUnits + reservation.units,
    },
  };
}

export function releaseReservation(
  account: ICreditAccount,
  reservation: ICreditReservation,
): TCreditResult<ICreditAccount> {
  if (reservation.status !== 'reserved') {
    return {
      ok: false,
      error: createCreditError(
        'CREDIT_RESERVATION_NOT_ACTIVE',
        `Reservation ${reservation.reservationId} is not active`,
      ),
    };
  }
  return {
    ok: true,
    value: {
      ...account,
      reservedUnits: Math.max(0, account.reservedUnits - reservation.units),
    },
  };
}

export function settleReservation(
  account: ICreditAccount,
  reservation: ICreditReservation,
  actualUnits: number,
): TCreditResult<ICreditAccount> {
  if (reservation.status !== 'reserved') {
    return {
      ok: false,
      error: createCreditError(
        'CREDIT_RESERVATION_NOT_ACTIVE',
        `Reservation ${reservation.reservationId} is not active`,
      ),
    };
  }
  if (!Number.isSafeInteger(actualUnits) || actualUnits < 0) {
    return {
      ok: false,
      error: createCreditError('CREDIT_AMOUNT_INVALID', 'Settlement units must be non-negative'),
    };
  }
  if (actualUnits > reservation.units) {
    return {
      ok: false,
      error: createCreditError(
        'CREDIT_SETTLEMENT_EXCEEDS_RESERVATION',
        'Settlement units must not exceed reserved units',
      ),
    };
  }
  return {
    ok: true,
    value: {
      ...account,
      balanceUnits: account.balanceUnits - actualUnits,
      reservedUnits: Math.max(0, account.reservedUnits - reservation.units),
    },
  };
}
