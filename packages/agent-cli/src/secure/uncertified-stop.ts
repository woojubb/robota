/**
 * When a runtime that nothing certified ends itself.
 *
 * A runtime is started by a spawner for an owner and is useful to nobody until the spawner certifies
 * it. One that no spawner links to in time, or whose spawner left without certifying it, is
 * therefore ended: at once when it is idle, else when the work it is running ends, so nothing is cut
 * short. Both rules end the moment the runtime is certified. The rules follow events, never a poll:
 * the custody's, and the sessions' own when their activity may have changed.
 */
import type { IRuntimeAdmissionStatus } from '../session-inventory/runtime-admission.js';
import type { TCustodyEvent } from './runtime-custody.js';

/** How long a runtime waits for its spawner to link before it gives up. */
export const DEFAULT_NO_SPAWNER_MS = 30_000;

export interface IStopTimers {
  setTimer(callback: () => void, delayMs: number): { clear(): void };
}

export interface IUncertifiedStopOptions {
  readonly custody: {
    status(): IRuntimeAdmissionStatus;
    spawnerLinks(): number;
    onChange(listener: (event: TCustodyEvent) => void): () => void;
  };
  /** Ends the runtime. Called at most once. */
  readonly stop: (reason: string) => void;
  /** Whether any session is running work or waiting for an answer. */
  readonly isBusy: () => boolean;
  /** Be told when a session's activity may have changed; returns the way to stop. */
  readonly onActivity: (listener: () => void) => () => void;
  readonly noSpawnerMs?: number;
  readonly timers?: IStopTimers;
}

const NODE_TIMERS: IStopTimers = {
  setTimer: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    timer.unref();
    return { clear: () => clearTimeout(timer) };
  },
};

/**
 * Starts the rules once the runtime is ready. Returns the way to stop following them, which the
 * runtime calls when it ends for any other reason.
 */
export function armUncertifiedStop(options: IUncertifiedStopOptions): () => void {
  const { custody, isBusy } = options;
  if (custody.status().certified) return () => undefined;
  const timers = options.timers ?? NODE_TIMERS;
  let waitingForSpawner: { clear(): void } | undefined;
  let stopWatchingActivity: (() => void) | undefined;
  let finished = false;

  const finish = (): void => {
    finished = true;
    waitingForSpawner?.clear();
    waitingForSpawner = undefined;
    stopWatchingActivity?.();
    stopWatchingActivity = undefined;
    stopWatchingCustody();
  };
  const stopNow = (reason: string): void => {
    if (finished) return;
    finish();
    options.stop(reason);
  };
  const endWhenIdle = (): void => {
    if (!isBusy()) {
      stopNow('its spawner left without certifying it');
      return;
    }
    stopWatchingActivity ??= options.onActivity(() => {
      if (!isBusy()) stopNow('its spawner left without certifying it');
    });
  };
  const stopCustody = options.custody.onChange((event) => {
    if (finished) return;
    if (event === 'certified') {
      finish();
      return;
    }
    if (event === 'spawner-linked') {
      waitingForSpawner?.clear();
      waitingForSpawner = undefined;
      stopWatchingActivity?.();
      stopWatchingActivity = undefined;
      return;
    }
    if (custody.spawnerLinks() === 0) endWhenIdle();
  });
  const stopWatchingCustody = (): void => stopCustody();

  if (custody.spawnerLinks() === 0) {
    waitingForSpawner = timers.setTimer(
      () => stopNow('no spawner linked to it in time'),
      options.noSpawnerMs ?? DEFAULT_NO_SPAWNER_MS,
    );
  }
  return finish;
}
