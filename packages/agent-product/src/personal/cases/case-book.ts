/**
 * The cases a personal agent keeps: opening one from something noticed, noting, asking the person one
 * question through the feed, recording the answer, and closing. The agent writes most of this from
 * content other people wrote, so every text has a length, a case holds a bounded number of notes and
 * events, and only so many cases are open at once; a refusal says which limit was reached.
 *
 * Writes go in one order at a time. An answer or a close is written to the case first and to the feed
 * second, so a failure in between leaves a card that still looks open while the case moved on, never a
 * case that waits on a question nobody can see; answering such a card withdraws it. A question is the
 * one write that goes the other way: its card must exist for the case to name it, so the card is posted
 * first and withdrawn again if the case cannot be written.
 */
import { carriesSecretValue } from '../secret-values.js';

import type { GoalBook } from '../goals/goal-book.js';
import type { IFeedItem } from '../goals/types.js';
import type { ICase, ICaseNote, ICaseStore } from './types.js';

const TITLE_LIMIT = 120;
const SOURCE_LIMIT = 200;
const CONNECTOR_LIMIT = 80;
const NOTE_LIMIT = 1_000;
const QUESTION_LIMIT = 400;
const OPTION_LIMIT = 60;
const REPLY_LIMIT = 1_000;
const RESOLUTION_LIMIT = 300;
export const CASE_MAX_OPTIONS = 4;
const NOTES_MAX = 30;
const HISTORY_MAX = 100;
/** History kept free for what the agent does not start: the person's answer and the closing. */
const HISTORY_RESERVED = 2;
const OPEN_CASES_MAX = 20;
const LIST_LIMIT = 50;

export class CaseRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'CaseRefusedError';
  }
}

export interface ICaseBookOptions {
  readonly store: ICaseStore;
  /** Where a question is shown to the person, and where their answer is recorded. */
  readonly feed: GoalBook;
  readonly now?: () => Date;
}

export interface IOpenCaseInput {
  readonly title: string;
  /** What was noticed and why it matters; the case's first note. */
  readonly noticed: string;
  /** The agent's own stable reference to the item, so the same item opens one case. */
  readonly source: string;
  readonly connectorId?: string;
}

export interface IAskInput {
  readonly question: string;
  readonly options?: readonly string[];
  /** Whether the person may answer in their own words; by default, when there are no choices. */
  readonly allowsReply?: boolean;
}

export interface IAnswerInput {
  readonly choice?: string;
  readonly reply?: string;
}

/**
 * A text that is kept: one line, within its limit, and carrying no secret value. A case says what
 * happened, so it may be about a password or a token; only a value written out is refused.
 */
function kept(text: string, what: string, limit: number, multiline = false): string {
  const value = multiline ? text.trim() : text.replace(/\s+/gu, ' ').trim();
  if (value === '') throw new CaseRefusedError(`${what} cannot be empty`);
  if (value.length > limit)
    throw new CaseRefusedError(`${what} is longer than ${limit} characters`);
  if (carriesSecretValue(value))
    throw new CaseRefusedError(
      `${what} looks like it contains a secret value, so it is not kept in a case. Words such as password or token are fine: say what happened without writing the value out`,
    );
  return value;
}

/** What a question shows as its evidence: the case's notes so far, one per line. */
const evidence = (notes: readonly ICaseNote[]): string =>
  notes.map((note) => `- ${note.text}`).join('\n');

export class CaseBook {
  private readonly store: ICaseStore;
  private readonly feed: GoalBook;
  private readonly now: () => Date;
  private sequence = 0;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(options: ICaseBookOptions) {
    this.store = options.store;
    this.feed = options.feed;
    this.now = options.now ?? (() => new Date());
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  /** One write at a time, so two calls in one turn cannot both pass a check the other changes. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async require(id: string): Promise<ICase> {
    const found = await this.store.get(id);
    if (found === undefined) throw new CaseRefusedError(`No case ${id}`);
    return found;
  }

  private async requireOpen(id: string): Promise<ICase> {
    const found = await this.require(id);
    if (found.state === 'closed') throw new CaseRefusedError('This case is closed');
    return found;
  }

  /** A card that still looks open although its case moved on becomes a withdrawn one, which can be dismissed. */
  private async stale(feedItemId: string, reason: string): Promise<never> {
    await this.feed.withdrawQuestion(feedItemId);
    throw new CaseRefusedError(reason);
  }

  private requireRoom(found: ICase): void {
    if (found.history.length >= HISTORY_MAX - HISTORY_RESERVED)
      throw new CaseRefusedError(
        'This case has grown as far as it can: close it, and open a new one if the matter goes on',
      );
  }

  /** Open a case, or return the one this source already opened, open or closed. */
  open(input: IOpenCaseInput): Promise<{ readonly case: ICase; readonly existing: boolean }> {
    return this.exclusive(async () => {
      const title = kept(input.title, 'The title', TITLE_LIMIT);
      const noticed = kept(input.noticed, 'What was noticed', NOTE_LIMIT);
      const source = kept(input.source, 'The source reference', SOURCE_LIMIT);
      const connectorId =
        input.connectorId === undefined
          ? undefined
          : kept(input.connectorId, 'The connector id', CONNECTOR_LIMIT);
      const cases = await this.store.list();
      const existing = cases.find(
        (item) => item.origin.source === source && item.origin.connectorId === connectorId,
      );
      if (existing !== undefined) return { case: existing, existing: true };
      if (cases.filter((item) => item.state === 'open').length >= OPEN_CASES_MAX)
        throw new CaseRefusedError(
          `${OPEN_CASES_MAX} cases are open already: close one before opening another`,
        );
      const at = this.stamp();
      this.sequence += 1;
      const opened: ICase = {
        id: `case-${this.now().getTime().toString(36)}${this.sequence.toString(36)}`,
        title,
        origin: { source, ...(connectorId !== undefined && { connectorId }) },
        state: 'open',
        notes: [{ at, text: noticed }],
        history: [{ at, kind: 'observed', text: noticed }],
        createdAt: at,
        updatedAt: at,
      };
      await this.store.put(opened);
      return { case: opened, existing: false };
    });
  }

  note(id: string, text: string): Promise<ICase> {
    return this.exclusive(async () => {
      const found = await this.requireOpen(id);
      const value = kept(text, 'A note', NOTE_LIMIT);
      if (found.notes.length >= NOTES_MAX)
        throw new CaseRefusedError(`This case holds ${NOTES_MAX} notes already`);
      this.requireRoom(found);
      const at = this.stamp();
      const next: ICase = {
        ...found,
        notes: [...found.notes, { at, text: value }],
        history: [...found.history, { at, kind: 'noted', text: value }],
        updatedAt: at,
      };
      await this.store.put(next);
      return next;
    });
  }

  /** Ask the person the case's one question; it shows in their feed with the notes as its evidence. */
  ask(id: string, input: IAskInput): Promise<{ readonly case: ICase; readonly item: IFeedItem }> {
    return this.exclusive(async () => {
      const found = await this.requireOpen(id);
      if (found.question !== undefined)
        throw new CaseRefusedError('This case already has a question waiting for the person');
      this.requireRoom(found);
      const text = kept(input.question, 'The question', QUESTION_LIMIT);
      const options = [
        ...new Set((input.options ?? []).map((option) => kept(option, 'A choice', OPTION_LIMIT))),
      ];
      if (options.length > CASE_MAX_OPTIONS)
        throw new CaseRefusedError(`A question offers at most ${CASE_MAX_OPTIONS} choices`);
      const allowsReply = input.allowsReply ?? options.length === 0;
      if (options.length === 0 && !allowsReply)
        throw new CaseRefusedError('A question needs choices, or must allow a reply');
      const item = await this.feed.post({
        kind: 'question',
        title: found.title,
        body: evidence(found.notes),
        question: { caseId: found.id, text, options, allowsReply, state: 'open' },
      });
      const at = this.stamp();
      const next: ICase = {
        ...found,
        question: { text, options, allowsReply, askedAt: at, feedItemId: item.id },
        history: [...found.history, { at, kind: 'asked', text }],
        updatedAt: at,
      };
      try {
        await this.store.put(next);
      } catch (failure) {
        // No case names this card, so it could never be answered or dismissed: withdraw it, and report
        // the write that failed rather than a failure of the clean-up.
        await this.feed.withdrawQuestion(item.id).catch(() => undefined);
        throw failure;
      }
      return { case: next, item };
    });
  }

  /**
   * Record the person's answer to a question in the feed: one of its choices, or a reply when the
   * question allows one. The case moves on with no question waiting; what to do next is not decided here.
   */
  answer(
    feedItemId: string,
    input: IAnswerInput,
  ): Promise<{ readonly case: ICase; readonly item: IFeedItem }> {
    return this.exclusive(async () => {
      const waiting = (await this.feed.feedItem(feedItemId))?.question;
      if (waiting === undefined) throw new CaseRefusedError(`No question ${feedItemId}`);
      if (waiting.state === 'answered')
        throw new CaseRefusedError('This question was already answered');
      if (waiting.state === 'withdrawn')
        throw new CaseRefusedError('The case was closed before this question was answered');
      const found = await this.store.get(waiting.caseId);
      if (found === undefined) return this.stale(feedItemId, 'The case for this question is gone');
      if (found.state === 'closed') return this.stale(feedItemId, 'This case is closed');
      if (found.question?.feedItemId !== feedItemId)
        return this.stale(feedItemId, 'This question is no longer waiting for an answer');
      if ((input.choice === undefined) === (input.reply === undefined))
        throw new CaseRefusedError('Answer with one of the choices, or with a reply');
      let answer: IAnswerInput;
      if (input.choice !== undefined) {
        if (!waiting.options.includes(input.choice))
          throw new CaseRefusedError('That is not one of the choices offered');
        answer = { choice: input.choice };
      } else {
        if (!waiting.allowsReply)
          throw new CaseRefusedError('This question takes one of its choices, not a reply');
        answer = { reply: kept(input.reply!, 'The reply', REPLY_LIMIT, true) };
      }
      const at = this.stamp();
      const { question: _answered, ...rest } = found;
      const next: ICase = {
        ...rest,
        history: [...found.history, { at, kind: 'answered', text: answer.choice ?? answer.reply! }],
        updatedAt: at,
      };
      await this.store.put(next);
      return { case: next, item: await this.feed.answerQuestion(feedItemId, answer) };
    });
  }

  /**
   * Settle a case with a one-line resolution; a question still waiting is withdrawn from the feed. The
   * case is written first: if that fails nothing changed and the case still waits on a visible card, and
   * if the withdrawal fails the case is closed and its card is withdrawn when the person next answers it.
   */
  close(id: string, resolution: string): Promise<ICase> {
    return this.exclusive(async () => {
      const found = await this.requireOpen(id);
      const text = kept(resolution, 'The resolution', RESOLUTION_LIMIT);
      const at = this.stamp();
      const { question: waiting, ...rest } = found;
      const next: ICase = {
        ...rest,
        state: 'closed',
        history: [...found.history, { at, kind: 'closed', text }],
        updatedAt: at,
      };
      await this.store.put(next);
      if (waiting !== undefined) await this.feed.withdrawQuestion(waiting.feedItemId);
      return next;
    });
  }

  async get(id: string): Promise<ICase | undefined> {
    return this.store.get(id);
  }

  /** Open cases first, then the ones closed last; each newest first. */
  async list(limit = LIST_LIMIT): Promise<readonly ICase[]> {
    const byRecency = (a: ICase, b: ICase): number =>
      b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id);
    const cases = await this.store.list();
    return [
      ...cases.filter((item) => item.state === 'open').sort(byRecency),
      ...cases.filter((item) => item.state === 'closed').sort(byRecency),
    ].slice(0, limit);
  }
}
