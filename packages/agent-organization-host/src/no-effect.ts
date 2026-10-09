import { OrganizationRefused } from './types.js';
import { units } from './verification.js';
import type { IOrganizationUnits, TOrganizationRefusal } from './types.js';

const NO_EFFECT_REASONS = [
  'budget-exhausted',
  'not-authorized',
  'invalid-schema',
  'expired',
  'revoked',
  'operation-conflict',
  'operation-pending',
] as const;
export type TOrganizationNoEffectReason = (typeof NO_EFFECT_REASONS)[number];

export function noEffectReason(value: unknown): TOrganizationNoEffectReason {
  if (
    typeof value !== 'string' ||
    !NO_EFFECT_REASONS.includes(value as TOrganizationNoEffectReason)
  )
    throw new OrganizationRefused('invalid-schema');
  return value as TOrganizationNoEffectReason;
}

/** Trusted asset-owner evidence of a confirmed transaction rollback, never an unverified provider error. */
export class OrganizationNoEffect extends OrganizationRefused {
  readonly usage: IOrganizationUnits;
  constructor(reason: TOrganizationRefusal, usage: IOrganizationUnits) {
    super(noEffectReason(reason));
    this.usage = units(usage);
  }
}
