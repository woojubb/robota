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
  rmdirSync,
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
const CASE_ID = /^case-[a-z0-9]{1,40}$/u;
const OWNER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.live$/u;
type TStoredAnswer = ICaseAnswerEvent & { readonly ownerId: string };

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
  readonly ownerId: string;
  readonly withCaseLock: <T>(work: () => Promise<T>) => Promise<T>;
  readonly deliver: (item: ICase, ownerId: string) => Promise<void>;
}) {
  const directory = join(options.stateDir, 'case-answer-outbox');
  const caseDirectory = (caseId: string): string => {
    if (!CASE_ID.test(caseId)) throw new Error('Invalid case id');
    return join(directory, caseId);
  };
  const pathOf = (caseId: string, id: string): string => {
    if (!FEED_ID.test(id)) throw new Error('Invalid case answer id');
    return join(caseDirectory(caseId), `${id}.json`);
  };
  const caseDirectories = (): string[] => {
    try {
      return readdirSync(directory).filter((name) => CASE_ID.test(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error('Case answer recovery records cannot be inspected');
    }
  };
  const has = (id: string, caseId?: string): boolean => {
    for (const candidate of caseId === undefined ? caseDirectories() : [caseId]) {
      try {
        statSync(pathOf(candidate, id));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new Error('A case answer recovery record cannot be inspected');
      }
    }
    return false;
  };
  const read = (caseId: string, id: string): TStoredAnswer | undefined => {
    try {
      const value: unknown = JSON.parse(readFileSync(pathOf(caseId, id), 'utf8'));
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
      const event = value as TStoredAnswer;
      const question = event.before?.question;
      const card = event.item?.question;
      const choice = event.answer?.choice;
      const reply = event.answer?.reply;
      if (
        event.before?.id !== caseId ||
        typeof event.ownerId !== 'string' ||
        !OWNER_ID.test(event.ownerId) ||
        event.before.state !== 'open' ||
        !Array.isArray(event.before.history) ||
        question?.feedItemId !== id ||
        event.item?.id !== id ||
        card?.caseId !== caseId ||
        card.state !== 'open' ||
        card.text !== question.text ||
        card.allowsReply !== question.allowsReply ||
        JSON.stringify(card.options) !== JSON.stringify(question.options) ||
        event.after?.id !== event.before.id ||
        event.after.lastAnsweredFeedItemId !== id ||
        typeof event.after.updatedAt !== 'string' ||
        !(
          (typeof choice === 'string' && reply === undefined && card.options.includes(choice)) ||
          (typeof reply === 'string' &&
            choice === undefined &&
            card.allowsReply &&
            reply.trim() === reply &&
            reply !== '')
        )
      )
        throw new Error();
      const { question: _question, ...rest } = event.before;
      const expected: ICase = {
        ...rest,
        lastAnsweredFeedItemId: id,
        history: [
          ...event.before.history,
          { at: event.after.updatedAt, kind: 'answered', text: choice ?? reply! },
        ],
        updatedAt: event.after.updatedAt,
      };
      if (JSON.stringify(event.after) !== JSON.stringify(expected)) throw new Error();
      return event;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new Error('A case answer recovery record cannot be read');
    }
  };
  const forget = (caseId: string, id: string): void => {
    const path = pathOf(caseId, id);
    if (!has(id, caseId)) return;
    rmSync(path);
    const folder = caseDirectory(caseId);
    sync(folder);
    try {
      rmdirSync(folder);
      sync(directory);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error;
    }
  };
  const persistCase = async (): Promise<void> => {
    const path = join(options.stateDir, 'cases', 'cases.json');
    sync(path);
    sync(dirname(path));
  };
  const complete = (caseId: string, id: string): void => {
    if (!has(id, caseId)) return;
    for (const path of [
      join(options.stateDir, 'cases', 'cases.json'),
      join(options.stateDir, 'goals', 'feed.json'),
      join(options.stateDir, 'goals', 'goals.json'),
    ]) {
      sync(path);
      sync(dirname(path));
    }
    forget(caseId, id);
  };
  const prepare = async (event: ICaseAnswerEvent): Promise<void> => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    sync(dirname(directory));
    const folder = caseDirectory(event.before.id);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    sync(directory);
    const path = pathOf(event.before.id, event.item.id);
    if (has(event.item.id)) throw new Error('The case answer needs recovery');
    const temporary = join(folder, `${randomUUID()}.tmp`);
    let created = false;
    try {
      const fd = openSync(temporary, 'wx', 0o600);
      created = true;
      try {
        writeFileSync(fd, `${JSON.stringify({ ...event, ownerId: options.ownerId })}\n`);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, path);
      sync(folder);
    } finally {
      if (created) rmSync(temporary, { force: true });
    }
  };
  const recoverUnlocked = async (onlyId?: string, onlyCase?: string): Promise<readonly ICase[]> => {
    const records: { caseId: string; id: string }[] = [];
    for (const caseId of onlyCase === undefined ? caseDirectories() : [onlyCase]) {
      try {
        const ids =
          onlyId === undefined
            ? readdirSync(caseDirectory(caseId))
                .filter((name) => name.endsWith('.json'))
                .map((name) => name.slice(0, -5))
            : has(onlyId, caseId)
              ? [onlyId]
              : [];
        records.push(...ids.map((id) => ({ caseId, id })));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        if (onlyId !== undefined || onlyCase !== undefined) throw error;
      }
    }
    if (onlyId !== undefined && records.length > 1)
      throw new Error('A case answer recovery record is ambiguous');
    const delivered: ICase[] = [];
    for (const { caseId, id } of records) {
      try {
        const event = read(caseId, id);
        if (event === undefined) continue;
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
          forget(caseId, id);
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
        if (current!.lastAnsweredFeedItemId === id) {
          await options.deliver(current!, event.ownerId);
        } else {
          const latest = current!.lastAnsweredFeedItemId;
          const goal = (await options.goals.list()).find((item) => item.caseId === caseId);
          if (
            latest === undefined ||
            (goal?.pendingCaseAnswer?.feedItemId !== latest &&
              goal?.lastCaseAnswerId !== latest &&
              !has(latest, caseId))
          )
            throw new Error('The newer case answer requires manual recovery');
        }
        complete(caseId, id);
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
  const hasOwner = (ownerId: string): boolean => {
    try {
      for (const caseId of caseDirectories()) {
        for (const name of readdirSync(caseDirectory(caseId))) {
          if (!name.endsWith('.json')) continue;
          try {
            if (read(caseId, name.slice(0, -5))?.ownerId === ownerId) return true;
          } catch {
            return true;
          }
        }
      }
      return false;
    } catch {
      return true;
    }
  };
  return { prepare, complete, persistCase, recover, stopCase, has, hasOwner };
}
