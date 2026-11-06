import type { IBackgroundTaskRunner } from '../types.js';

const preparedRunners = new WeakMap<IBackgroundTaskRunner, unknown>();

export function registerBuiltInScheduledRunner<T extends IBackgroundTaskRunner<'scheduled'>>(
  runner: T,
): T {
  preparedRunners.set(runner, runner.prepareRestore);
  return runner;
}

export function isBuiltInScheduledRestoreRunner(runner: IBackgroundTaskRunner): boolean {
  return preparedRunners.has(runner) && preparedRunners.get(runner) === runner.prepareRestore;
}
