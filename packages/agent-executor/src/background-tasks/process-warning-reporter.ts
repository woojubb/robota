import { describeObserverFailure, OBSERVER_FAILURE_WARNING_CODE } from './observer-delivery.js';

import type { IObserverFailure } from './observer-delivery.js';

/**
 * Surface an observer failure as a process warning (stderr, `warning` event) without crashing the
 * host. It runs outside the emitter's call stack. A Node host passes it as `onObserverFailure`.
 */
export function reportObserverFailureAsProcessWarning<TEvent>(
  failure: IObserverFailure<TEvent>,
  code: string = OBSERVER_FAILURE_WARNING_CODE,
): void {
  process.emitWarning(describeObserverFailure(failure), { code });
}
