/**
 * The contract between the execution loop and a provider that can answer on more than one model.
 *
 * The loop never picks a substitute model — it cannot build providers. It tells the provider which
 * run a call belongs to, and the provider tells it where a request goes and when it had to move on,
 * so every record of the call names the model that actually answered.
 */

import type { IModelRef } from './role-model';
import type { TProviderFailureReason } from '../utils/provider-failure';

/** A request moved to another model because the one it was on failed in a way another could serve. */
export interface IModelFallbackNotice {
  /** The model that failed. */
  from: IModelRef;
  /** The model the request moved to. */
  to: IModelRef;
  /** Why `from` could not serve it. */
  reason: TProviderFailureReason;
}

export type TModelFallbackCallback = (notice: IModelFallbackNotice) => void;
