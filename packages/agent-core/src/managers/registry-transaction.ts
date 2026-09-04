/**
 * ARCH-055 (#2159): the transactional lifecycle contract for registry-owned instances.
 *
 * A registry (agent factory, module registry, plugin set) mutates its state around asynchronous
 * initialization. Without one contract, a failure part-way leaves partial registration, wrong
 * statistics, or an initialized resource with no disposal path — and `TransportRegistry` had grown
 * its own serialized-startup-with-reverse-rollback while the agent/module/plugin family repeated the
 * partial-registration shape. This module names the contract once:
 *
 * - **Lifecycle identity.** An instance a registry owns declares its lifecycle through
 *   {@link IRegistryOwnedLifecycle}; {@link lifecycleOf} is the one type guard — no more per-registry
 *   `typeof x.cleanup === 'function'` duck-typing.
 * - **Commit timing.** Steps run in order; the registry's authoritative state changes only in the
 *   step that commits it, after every step that can fail has succeeded.
 * - **Reverse rollback.** When a step throws, the `undo` of every COMPLETED step runs in reverse
 *   order, always — a throwing `undo` does not stop the remaining ones.
 * - **Primary-error preservation.** The caller receives the step's error. Rollback failures are
 *   attached as {@link IRegistryTransactionError.rollbackErrors}, never substituted for it.
 */

export interface IRegistryOwnedLifecycle {
  initialize?(): Promise<void>;
  cleanup?(): Promise<void>;
}

/** The declared lifecycle of `instance`, or `undefined` when it declares none. */
export function lifecycleOf(instance: object): IRegistryOwnedLifecycle | undefined {
  const candidate = instance as Partial<Record<'initialize' | 'cleanup', unknown>>;
  const initialize = typeof candidate.initialize === 'function' ? candidate.initialize : undefined;
  const cleanup = typeof candidate.cleanup === 'function' ? candidate.cleanup : undefined;
  if (initialize === undefined && cleanup === undefined) return undefined;
  return {
    ...(initialize ? { initialize: () => (initialize as () => Promise<void>).call(instance) } : {}),
    ...(cleanup ? { cleanup: () => (cleanup as () => Promise<void>).call(instance) } : {}),
  };
}

export interface IRegistryTransactionStep {
  readonly name: string;
  run(): Promise<void> | void;
  /** Reverses `run`. Called only if `run` completed and a LATER step failed. */
  undo?(): Promise<void> | void;
}

export interface IRegistryTransactionError extends Error {
  readonly failedStep: string;
  /** Errors thrown by `undo` handlers during rollback, in execution (reverse) order. */
  readonly rollbackErrors: readonly { step: string; error: unknown }[];
}

export function isRegistryTransactionError(error: unknown): error is IRegistryTransactionError {
  return error instanceof Error && 'failedStep' in error && 'rollbackErrors' in error;
}

/**
 * Run `steps` in order with reverse rollback on failure. Throws the FAILING step's error, decorated
 * with `failedStep` and `rollbackErrors` (the original error object is thrown, so `instanceof` on
 * the caller's own error classes keeps working).
 */
export async function runRegistryTransaction(
  steps: readonly IRegistryTransactionStep[],
): Promise<void> {
  const completed: IRegistryTransactionStep[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      // allow-fallback: this IS the rollback contract — the primary error is rethrown below after
      // every completed step has been reversed; nothing is swallowed.
      const rollbackErrors: { step: string; error: unknown }[] = [];
      for (const done of completed.reverse()) {
        if (done.undo === undefined) continue;
        try {
          await done.undo();
        } catch (undoError) {
          // allow-fallback: a failing undo must not stop the remaining undos; it is RECORDED on the
          // primary error, which the caller receives.
          rollbackErrors.push({ step: done.name, error: undoError });
        }
      }
      throw decorate(error, step.name, rollbackErrors);
    }
    completed.push(step);
  }
}

function decorate(
  error: unknown,
  failedStep: string,
  rollbackErrors: readonly { step: string; error: unknown }[],
): IRegistryTransactionError {
  const primary = error instanceof Error ? error : new Error(String(error));
  return Object.assign(primary, { failedStep, rollbackErrors });
}
