/** Recover accepted case answers whose follow-up could not be queued. */
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
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
    if (!existsSync(path)) return;
    rmSync(path);
    sync(directory);
  };
  const complete = (id: string): void => {
    if (!existsSync(pathOf(id))) return;
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
    if (existsSync(path)) throw new Error('The case answer needs recovery');
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
  const recover = async (onlyId?: string): Promise<readonly ICase[]> =>
    options.withCaseLock(async () => {
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
        const event = read(id);
        if (event === undefined) continue;
        const current = await options.cases.get(event.before.id);
        const card = await options.goals.feedItem(id);
        if (JSON.stringify(current) === JSON.stringify(event.before)) {
          if (JSON.stringify(card) !== JSON.stringify(event.item))
            throw new Error('The case answer requires manual recovery');
          forget(id);
          continue;
        }
        if (
          JSON.stringify(current) !== JSON.stringify(event.after) ||
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
        await options.deliver(event.after);
        complete(id);
        delivered.push(event.after);
      }
      return delivered;
    });
  const has = (id: string): boolean => existsSync(pathOf(id));
  return { prepare, complete, recover, has };
}
