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

export interface IObserverFailure<TEvent> {
  readonly event: TEvent;
  readonly error: unknown;
  /** 0-based position of the failing observer in the delivery order. */
  readonly observerIndex: number;
}

export type TObserverFailureReporter<TEvent> = (failure: IObserverFailure<TEvent>) => void;

export const OBSERVER_FAILURE_WARNING_CODE = 'ROBOTA_BACKGROUND_OBSERVER_FAILURE';

/**
 * Default reporter: surface the failure as a process warning. It is visible (stderr, `warning`
 * event) without crashing the host, and it runs outside the emitter's call stack.
 */
export function reportObserverFailureAsWarning<TEvent>(failure: IObserverFailure<TEvent>): void {
  const message =
    failure.error instanceof Error ? failure.error.message : String(failure.error ?? 'unknown');
  const eventType =
    typeof failure.event === 'object' && failure.event !== null && 'type' in failure.event
      ? String((failure.event as { type: unknown }).type)
      : 'unknown';
  process.emitWarning(
    `Background lifecycle observer #${failure.observerIndex} threw on '${eventType}': ${message}`,
    { code: OBSERVER_FAILURE_WARNING_CODE },
  );
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
