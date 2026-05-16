import type { IBackgroundTaskManager } from './index.js';

const sessionBackgroundTaskManagers = new WeakMap<object, IBackgroundTaskManager>();

export function storeSessionBackgroundTaskManager(
  key: object,
  manager: IBackgroundTaskManager,
): void {
  sessionBackgroundTaskManagers.set(key, manager);
}

export function retrieveSessionBackgroundTaskManager(
  key: object,
): IBackgroundTaskManager | undefined {
  return sessionBackgroundTaskManagers.get(key);
}
