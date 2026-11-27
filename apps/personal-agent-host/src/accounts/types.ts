import type { IProviderInfo, IUnitLimits, RuntimeBackend } from '../runtime/port.js';

/**
 * `provisioning` and `deleting` are written before any runtime call and finished by removal when
 * the control plane starts, so a crash never leaves a half-made or half-removed account behind.
 */
export type AccountState = 'provisioning' | 'active' | 'suspended' | 'deleting';

/** Whose model key a unit receives: the account's own, the operator-wide one, or none. */
export type KeySource = 'account' | 'operator' | 'none';

export interface IAccountRecord {
  id: string;
  /** Fixed at creation. */
  hostname: string;
  backend: RuntimeBackend;
  state: AccountState;
  provider: IProviderInfo;
  keySource: KeySource;
  limits: IUnitLimits;
  subnetSlot: number;
  image: string;
  createdAt: string;
  updatedAt: string;
}
