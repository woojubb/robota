/** Serialize the shared feed across personal-agent processes and reject stale item updates. */
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

import { createFileGoalStore, GoalRefusedError } from '@robota-sdk/agent-product/personal';

import { createSharedLock } from './shared-lock.js';

import type { IFeedItem, IGoalStore } from '@robota-sdk/agent-product/personal';

function checkUpdate(
  current: IFeedItem | undefined,
  next: IFeedItem,
  options?: { readonly cancelApproved?: boolean },
): void {
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
        (before.state !== 'pending' &&
          before.state !== after.state &&
          !(
            options?.cancelApproved === true &&
            before.state === 'approved' &&
            after.state === 'expired'
          ))))
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
  const lock = createSharedLock(join(realpathSync(stateDir), '.feed-write.lock'), 'The feed');
  return {
    ...store,
    putFeedItem: (item, options) =>
      lock(async () => {
        checkUpdate(await store.getFeedItem(item.id), item, options);
        await store.putFeedItem(item);
      }),
  };
}
