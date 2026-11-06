import type { IBackgroundTaskRunner } from '../types.js';

const preparedRunners = new WeakMap<IBackgroundTaskRunner, { prepare: unknown; start: unknown }>();

export function registerBuiltInScheduledRunner<T extends IBackgroundTaskRunner<'scheduled'>>(
  runner: T,
): T {
  preparedRunners.set(runner, { prepare: runner.prepareRestore, start: runner.start });
  return runner;
}

export function isBuiltInScheduledRestoreRunner(
  runner: IBackgroundTaskRunner,
  prepare: IBackgroundTaskRunner['prepareRestore'],
): boolean {
  return preparedRunners.has(runner) && preparedRunners.get(runner)?.prepare === prepare;
}

export function isBuiltInScheduledStart(
  runner: IBackgroundTaskRunner,
  start: IBackgroundTaskRunner['start'],
): boolean {
  return preparedRunners.has(runner) && preparedRunners.get(runner)?.start === start;
}
