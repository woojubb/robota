/** A bounded shared filesystem lock; unknown owners are never displaced. */
import { GoalRefusedError } from '@robota-sdk/agent-product/personal';

import { tryDirectoryLock } from './connectors/directory-lock.js';

export function createSharedLock(path: string, subject: string) {
  return async <T>(work: () => Promise<T>): Promise<T> => {
    let held: { release(): void } | undefined;
    for (let attempt = 0; attempt <= 100; attempt += 1) {
      held = tryDirectoryLock(path);
      if (held !== undefined) break;
      if (attempt === 100)
        throw new GoalRefusedError(
          `${subject} is busy; stop all agents and follow the case-request recovery instructions in the Personal Agent guide`,
        );
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    if (held === undefined) throw new GoalRefusedError(`${subject} cannot be locked`);
    try {
      return await work();
    } finally {
      held.release();
    }
  };
}
