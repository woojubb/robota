/** Recover accepted case answers whose follow-up could not be queued. */
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import type {
  GoalBook,
  ICase,
  ICaseAnswerEvent,
  ICaseStore,
} from '@robota-sdk/agent-product/personal';

const FEED_ID = /^feed-[a-z0-9]{1,40}$/u;

function sync(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function createCaseAnswerOutbox(options: {
  readonly stateDir: string;
  readonly cases: ICaseStore;
  readonly goals: GoalBook;
  readonly withCaseLock: <T>(work: () => Promise<T>) => Promise<T>;
  readonly deliver: (item: ICase) => Promise<void>;
}) {
  const directory = join(options.stateDir, 'case-answer-outbox');
  const pathOf = (id: string): string => {
    if (!FEED_ID.test(id)) throw new Error('Invalid case answer id');
    return join(directory, `${id}.json`);
  };
  const has = (id: string): boolean => {
    try {
      statSync(pathOf(id));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new Error('A case answer recovery record cannot be inspected');
    }
  };
  const read = (id: string): ICaseAnswerEvent | undefined => {
    try {
      const value: unknown = JSON.parse(readFileSync(pathOf(id), 'utf8'));
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
      const event = value as ICaseAnswerEvent;
      if (
        event.item?.id !== id ||
        event.item.question?.caseId !== event.before?.id ||
        event.after?.id !== event.before.id ||
        event.after.lastAnsweredFeedItemId !== id ||
        (typeof event.answer?.choice !== 'string' && typeof event.answer?.reply !== 'string') ||
        (event.answer.choice !== undefined && event.answer.reply !== undefined)
      )
        throw new Error();
      return event;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new Error('A case answer recovery record cannot be read');
    }
  };
  const forget = (id: string): void => {
    const path = pathOf(id);
    if (!has(id)) return;
    rmSync(path);
    sync(directory);
  };
  const persistCase = async (): Promise<void> => {
    const path = join(options.stateDir, 'cases', 'cases.json');
    sync(path);
    sync(dirname(path));
  };
  const complete = (id: string): void => {
    if (!has(id)) return;
    for (const path of [
      join(options.stateDir, 'cases', 'cases.json'),
      join(options.stateDir, 'goals', 'feed.json'),
      join(options.stateDir, 'goals', 'goals.json'),
    ]) {
      sync(path);
      sync(dirname(path));
    }
    forget(id);
  };
  const prepare = async (event: ICaseAnswerEvent): Promise<void> => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    sync(dirname(directory));
    const path = pathOf(event.item.id);
    if (has(event.item.id)) throw new Error('The case answer needs recovery');
    const temporary = join(directory, `${randomUUID()}.tmp`);
    let created = false;
    try {
      const fd = openSync(temporary, 'wx', 0o600);
      created = true;
      try {
        writeFileSync(fd, `${JSON.stringify(event)}\n`);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, path);
      sync(directory);
    } finally {
      if (created) rmSync(temporary, { force: true });
    }
  };
  const recoverUnlocked = async (onlyId?: string, onlyCase?: string): Promise<readonly ICase[]> => {
    let ids: string[];
    try {
      ids =
        onlyId === undefined
          ? readdirSync(directory)
              .filter((name) => name.endsWith('.json'))
              .map((name) => name.slice(0, -5))
          : [onlyId];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error('Case answer recovery records cannot be read');
    }
    const delivered: ICase[] = [];
    for (const id of ids) {
      try {
        if (onlyCase !== undefined) {
          const card = await options.goals.feedItem(id);
          if (card?.question !== undefined && card.question.caseId !== onlyCase) continue;
        }
        const event = read(id);
        if (event === undefined) continue;
        if (onlyCase !== undefined && event.before.id !== onlyCase) continue;
        let current = await options.cases.get(event.before.id);
        const card = await options.goals.feedItem(id);
        if (
          JSON.stringify(current) === JSON.stringify(event.before) &&
          card?.question?.caseId === event.before.id &&
          card.question.state === 'answered' &&
          card.question.answer?.choice === event.answer.choice &&
          card.question.answer?.reply === event.answer.reply
        ) {
          await options.cases.put(event.after);
          await persistCase();
          current = event.after;
        }
        const prefix = (expected: ICase): boolean =>
          current !== undefined &&
          current.id === expected.id &&
          current.createdAt === expected.createdAt &&
          JSON.stringify(current.history.slice(0, expected.history.length)) ===
            JSON.stringify(expected.history);
        if (prefix(event.before) && !prefix(event.after)) {
          const later = current!.history.slice(event.before.history.length);
          if (
            later.some((entry) => entry.kind === 'answered') ||
            card?.question?.caseId !== current!.id ||
            (current!.question?.feedItemId !== id && current!.state !== 'closed') ||
            !['open', 'withdrawn'].includes(card.question.state)
          )
            throw new Error('The case answer requires manual recovery');
          if (current!.state === 'closed' && card.question.state === 'open')
            await options.goals.withdrawQuestion(id);
          forget(id);
          continue;
        }
        if (
          !prefix(event.after) ||
          (current!.lastAnsweredFeedItemId !== id &&
            !current!.history
              .slice(event.after.history.length)
              .some((entry) => entry.kind === 'answered')) ||
          card?.question === undefined ||
          card.question.caseId !== event.before.id
        )
          throw new Error('The case answer requires manual recovery');
        if (card.question.state === 'open') {
          await options.goals.answerQuestion(id, event.answer);
        } else if (
          card.question.state !== 'answered' ||
          card.question.answer?.choice !== event.answer.choice ||
          card.question.answer?.reply !== event.answer.reply
        ) {
          throw new Error('The case answer requires manual recovery');
        }
        if (current!.state === 'closed' && current!.lastAnsweredFeedItemId === id) {
          const closed = current!.history.at(-1);
          if (closed?.kind === 'closed') await options.goals.resolveQuestion(id, closed.text);
        }
        await options.deliver(current!);
        complete(id);
        delivered.push(current!);
      } catch (error) {
        if (onlyId !== undefined || onlyCase !== undefined) throw error;
        // Keep a damaged record in place; unrelated cases can still recover and run.
      }
    }
    return delivered;
  };
  const recover = (onlyId?: string): Promise<readonly ICase[]> =>
    options.withCaseLock(() => recoverUnlocked(onlyId));
  const stopCase = (caseId: string, work: () => Promise<void>): Promise<void> =>
    options.withCaseLock(async () => {
      await recoverUnlocked(undefined, caseId);
      await work();
    });
  return { prepare, complete, persistCase, recover, stopCase, has };
}
