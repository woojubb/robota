import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';
import { buildValidationError } from '../utils/error-builders.js';

/** Live root authority. Reservations are made synchronously before executing a node. */
export interface IRootCreditBudget {
  reserve(estimatedCredits: number): TResult<ICreditReservation, IDagError>;
  close(): void;
}

export interface ICreditReservation {
  /** Charge a successfully completed node and return the root's cumulative total. */
  commit(): number;
  /** Return capacity when execution did not complete successfully. */
  release(): void;
}

export class RootCreditBudget implements IRootCreditBudget {
  private committed = 0;
  private reserved = 0;
  private closed = false;

  public constructor(private readonly limit?: number) {
    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
      throw new RangeError('Root credit limit must be positive and finite');
    }
  }

  public close(): void {
    this.closed = true;
  }

  public reserve(estimatedCredits: number): TResult<ICreditReservation, IDagError> {
    if (!Number.isFinite(estimatedCredits) || estimatedCredits < 0) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_NEGATIVE_ESTIMATED_CREDITS',
          'estimatedCredits must be finite and zero or positive',
          { estimatedCredits },
        ),
      };
    }
    if (
      this.closed ||
      (this.limit !== undefined && estimatedCredits > this.limit - this.committed - this.reserved)
    ) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_CREDIT_LIMIT_EXCEEDED',
          'Estimated run credits exceeds root runCreditLimit',
          { estimatedCredits, ...(this.limit === undefined ? {} : { runCreditLimit: this.limit }) },
        ),
      };
    }
    this.reserved += estimatedCredits;
    let settled = false;
    return {
      ok: true,
      value: {
        commit: () => {
          if (!settled) {
            settled = true;
            this.reserved -= estimatedCredits;
            this.committed += estimatedCredits;
          }
          return this.committed;
        },
        release: () => {
          if (!settled) {
            settled = true;
            this.reserved -= estimatedCredits;
          }
        },
      },
    };
  }
}
