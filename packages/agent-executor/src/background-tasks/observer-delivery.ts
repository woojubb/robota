/**
 * ARCH-053 (#2157): observer-failure contract for background lifecycle owners.
 *
 * A lifecycle owner (task manager, job-group orchestrator) emits an event only AFTER the
 * authoritative state transition is committed. A throwing observer must therefore never unwind
 * the emitter's call stack: doing so rejects an admission whose state is already recorded, leaves
 * acquired capacity stuck, skips queue draining, or turns a completed transition into an
 * unhandled rejection. This module is the one place that defines what happens instead:
 *
 * - every observer is isolated — one throwing observer does not stop delivery to the others;
 * - delivery continues to every remaining observer in registration order;
 * - every failure is reported, never swallowed, through an explicit reporter.
 */

import { createLogger } from '@robota-sdk/agent-core';

export interface IObserverFailure<TEvent> {
  readonly event: TEvent;
  readonly error: unknown;
  /** 0-based position of the failing observer in the delivery order. */
  readonly observerIndex: number;
}

export type TObserverFailureReporter<TEvent> = (failure: IObserverFailure<TEvent>) => void;

/** Default identity for hosts that do not supply their own warning code. */
export const OBSERVER_FAILURE_WARNING_CODE = 'BACKGROUND_OBSERVER_FAILURE';

/** One line saying which observer failed on which event, and why. */
export function describeObserverFailure<TEvent>(failure: IObserverFailure<TEvent>): string {
  const message =
    failure.error instanceof Error ? failure.error.message : String(failure.error ?? 'unknown');
  const eventType =
    typeof failure.event === 'object' && failure.event !== null && 'type' in failure.event
      ? String((failure.event as { type: unknown }).type)
      : 'unknown';
  return `Background lifecycle observer #${failure.observerIndex} threw on '${eventType}': ${message}`;
}

const observerLogger = createLogger('BackgroundObserver');

/**
 * Default reporter: log the failure as a warning carrying `code`, through agent-core's logger. It
 * runs outside the emitter's call stack and never throws. The logger is silent until the host
 * installs a sink, so a host that must see these failures injects its own reporter — the Node one is
 * `reportObserverFailureAsProcessWarning` in `@robota-sdk/agent-executor/node`.
 */
export function reportObserverFailureAsLogWarning<TEvent>(
  failure: IObserverFailure<TEvent>,
  code: string = OBSERVER_FAILURE_WARNING_CODE,
): void {
  observerLogger.warn(describeObserverFailure(failure), { code });
}

/**
 * Deliver `event` to every observer, isolating each one. Returns the number of observers that
 * threw. A reporter that itself throws is treated as a defect of the reporter and is NOT caught —
 * the reporter is the host's own code, injected on purpose.
 */
export function deliverToObservers<TEvent>(
  event: TEvent,
  observers: Iterable<(event: TEvent) => void>,
  report: TObserverFailureReporter<TEvent>,
): number {
  let failures = 0;
  let observerIndex = 0;
  for (const observer of observers) {
    try {
      observer(event);
    } catch (error) {
      // allow-fallback: observer isolation IS the contract — the failure is reported through the
      // injected reporter, and the already-committed state transition must not be unwound by it.
      failures += 1;
      report({ event, error, observerIndex });
    }
    observerIndex += 1;
  }
  return failures;
}
