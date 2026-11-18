/** Serialize the shared feed across personal-agent processes and reject stale item updates. */
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

import { createFileGoalStore, GoalRefusedError } from '@robota-sdk/agent-product/personal';

import { tryDirectoryLock } from './connectors/directory-lock.js';

import type { IFeedItem, IGoalStore } from '@robota-sdk/agent-product/personal';

function checkUpdate(current: IFeedItem | undefined, next: IFeedItem): void {
  if (current === undefined) return;
  if (
    current.kind !== next.kind ||
    current.at !== next.at ||
    current.title !== next.title ||
    current.body !== next.body ||
    current.goalId !== next.goalId ||
    current.runId !== next.runId ||
    (current.dismissed && !next.dismissed)
  )
    throw new GoalRefusedError('This feed item changed; try again');
  const before = current.approval;
  const after = next.approval;
  if (
    (before === undefined) !== (after === undefined) ||
    (before !== undefined &&
      after !== undefined &&
      (before.tool !== after.tool ||
        before.detail !== after.detail ||
        (before.state !== 'pending' && before.state !== after.state)))
  )
    throw new GoalRefusedError('This approval changed; try again');
  const question = current.question;
  const changed = next.question;
  if (
    (question === undefined) !== (changed === undefined) ||
    (question !== undefined &&
      changed !== undefined &&
      (question.caseId !== changed.caseId ||
        question.text !== changed.text ||
        question.allowsReply !== changed.allowsReply ||
        JSON.stringify(question.options) !== JSON.stringify(changed.options) ||
        (question.state !== 'open' && question.state !== changed.state) ||
        (question.answer !== undefined &&
          JSON.stringify(question.answer) !== JSON.stringify(changed.answer)) ||
        (question.resolution !== undefined && question.resolution !== changed.resolution)))
  )
    throw new GoalRefusedError('This question changed; try again');
}

export function createSharedFeedStore(stateDir: string): IGoalStore {
  const store = createFileGoalStore(join(stateDir, 'goals'));
  const lockPath = join(realpathSync(stateDir), '.feed-write.lock');
  return {
    ...store,
    putFeedItem: async (item) => {
      let held: { release(): void } | undefined;
      for (let attempt = 0; attempt <= 100; attempt += 1) {
        held = tryDirectoryLock(lockPath);
        if (held !== undefined) break;
        if (attempt === 100)
          throw new GoalRefusedError(
            'The feed is busy; stop all agents and follow the case-request recovery instructions in the Personal Agent guide',
          );
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      if (held === undefined) throw new GoalRefusedError('The feed cannot be locked');
      try {
        checkUpdate(await store.getFeedItem(item.id), item);
        await store.putFeedItem(item);
      } finally {
        held.release();
      }
    },
  };
}
