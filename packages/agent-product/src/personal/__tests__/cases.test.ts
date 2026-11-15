import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearRegisteredToolProfiles,
  evaluatePermission,
  getToolPermissionProfile,
} from '@robota-sdk/agent-core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CASE_TOOL_NAMES,
  CaseBook,
  CaseRefusedError,
  GoalBook,
  GoalRefusedError,
  createCaseTools,
  createFileCaseStore,
  createFileGoalStore,
  createMemoryCaseStore,
  createMemoryGoalStore,
} from '../index.js';

import type { TToolParameters } from '@robota-sdk/agent-core';

import type { ICaseStore, IGoalStore } from '../index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cases-'));
  dirs.push(dir);
  return dir;
}

/** A clock that moves forward on every reading, so events have an order. */
function clock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 10, 16, 9, 0, tick++));
}

interface IWorld {
  readonly book: CaseBook;
  readonly goals: GoalBook;
}

function world(cases: ICaseStore, feed: IGoalStore): IWorld {
  const now = clock();
  const goals = new GoalBook({ store: feed, now });
  return { book: new CaseBook({ store: cases, feed: goals, now }), goals };
}

/** A card that was stuck open is now a withdrawn one, and the person can clear it from the feed. */
async function expectCleared(goals: GoalBook, feedItemId: string): Promise<void> {
  expect((await goals.feedItem(feedItemId))?.question?.state).toBe('withdrawn');
  await goals.dismiss(feedItemId);
  expect((await goals.feedItem(feedItemId))?.dismissed).toBe(true);
}

const SIGN_IN = {
  title: 'New sign-in to your account',
  noticed: 'A mail from Example says a new sign-in happened from Seoul at 10:02.',
  source: 'mail:message-1',
  connectorId: 'connector-mail-1',
};

// The Korean word for "password", built from code points: the repository keeps no Korean outside its
// localization data, and the shared secret check knows this word.
const KOREAN_PASSWORD = String.fromCodePoint(0xbe44, 0xbc00, 0xbc88, 0xd638);

/**
 * Secret values, each short enough for the shortest text a case takes. Key-shaped ones are spelled in
 * two parts so the repository's own secret scan does not read the fixture as a real key.
 */
const SECRET_VALUES = [
  `${'sk-'}proj-abcdefghijklmnopqrstuvwx1234567890`,
  `${'ghp_'}abcdefghijklmnopqrstuvwxyz0123456789`,
  `${'AKIA'}ABCDEFGHIJKLMNOP`,
  `${'eyJhbGciOiJIUzI1NiJ9'}.${'eyJzdWIiOiIxMjM0'}.abcdefghijkl`,
  'password=hunter2',
  'token: abc123',
  '4111 1111 1111 1111',
  '900101-1234567',
  `${'-----BEGIN'} RSA PRIVATE KEY-----`,
  'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7x',
];

describe.each([
  ['memory', () => world(createMemoryCaseStore(), createMemoryGoalStore())],
  ['file', () => world(createFileCaseStore(directory()), createFileGoalStore(directory()))],
])('case book over a %s store', (_name, makeWorld) => {
  it('opens one case per source, and gives a source that was settled the case back instead of a new one', async () => {
    const { book } = makeWorld();
    const first = await book.open(SIGN_IN);
    expect(first.existing).toBe(false);
    expect(first.case.state).toBe('open');
    expect(first.case.notes.map((note) => note.text)).toEqual([SIGN_IN.noticed]);
    expect(first.case.history.map((event) => event.kind)).toEqual(['observed']);

    const again = await book.open({ ...SIGN_IN, title: 'Something else entirely' });
    expect(again.existing).toBe(true);
    expect(again.case.id).toBe(first.case.id);

    await book.close(first.case.id, 'The person confirmed it was them.');
    const afterClose = await book.open(SIGN_IN);
    expect(afterClose.existing).toBe(true);
    expect(afterClose.case.state).toBe('closed');
    // The same reference at another service, or with none, is another item.
    expect((await book.open({ ...SIGN_IN, connectorId: 'connector-mail-2' })).existing).toBe(false);
    const { connectorId: _none, ...withoutConnector } = SIGN_IN;
    expect((await book.open(withoutConnector)).existing).toBe(false);
  });

  it('opens one case when two calls arrive together for the same source', async () => {
    const { book } = makeWorld();
    const [a, b] = await Promise.all([book.open(SIGN_IN), book.open(SIGN_IN)]);
    expect(a.case.id).toBe(b.case.id);
    expect([a.existing, b.existing].sort()).toEqual([false, true]);
    expect(await book.list()).toHaveLength(1);
  });

  it('refuses what is empty, too long or looks like a secret, and says which text it was', async () => {
    const { book } = makeWorld();
    await expect(book.open({ ...SIGN_IN, title: '   ' })).rejects.toThrow(/title cannot be empty/u);
    await expect(book.open({ ...SIGN_IN, title: 'x'.repeat(121) })).rejects.toThrow(
      /title is longer than 120/u,
    );
    await expect(book.open({ ...SIGN_IN, noticed: 'y'.repeat(1_001) })).rejects.toThrow(
      /What was noticed is longer than 1000/u,
    );
    await expect(book.open({ ...SIGN_IN, source: 's'.repeat(201) })).rejects.toThrow(
      /source reference is longer than 200/u,
    );
    await expect(
      book.open({ ...SIGN_IN, noticed: 'The code is: password: hunter2-very-secret' }),
    ).rejects.toThrow(CaseRefusedError);
    expect(await book.list()).toEqual([]);
  });

  it('keeps a case about a password and the words around it, since a case says what happened and not what the secret is', async () => {
    const { book } = makeWorld();
    const noticed = 'Acme says a password reset was requested for your account';
    const { case: opened } = await book.open({
      title: 'Password reset requested',
      noticed,
      source: 'mail:reset-1',
      connectorId: 'connector-mail-1',
    });
    expect(opened.notes.map((note) => note.text)).toEqual([noticed]);
    for (const text of [
      'The mail asks for a one-time token before the reset link works.',
      'It never says the secret or the API key; the private key is not mentioned.',
      `The mail uses the word ${KOREAN_PASSWORD} once.`,
    ]) {
      expect((await book.note(opened.id, text)).notes.at(-1)?.text).toBe(text);
    }
    const question = 'Have you changed your password and signed out other sessions?';
    const { case: asked, item } = await book.ask(opened.id, {
      question,
      options: ['Yes, password changed', 'No, not my token'],
      allowsReply: true,
    });
    expect(asked.question?.text).toBe(question);
    expect(item.question?.options).toEqual(['Yes, password changed', 'No, not my token']);
    const answered = await book.answer(item.id, { reply: 'I already reset my password' });
    expect(answered.case.history.at(-1)).toEqual(
      expect.objectContaining({ kind: 'answered', text: 'I already reset my password' }),
    );
    const closed = await book.close(opened.id, 'The person had already reset the password.');
    expect(closed.state).toBe('closed');
    expect(closed.history.at(-1)?.text).toBe('The person had already reset the password.');
  });

  it('refuses a secret value in every text a case takes, says the words themselves are fine, and writes nothing', async () => {
    const { book, goals } = makeWorld();
    const plain = (await book.open({ ...SIGN_IN, source: 'mail:plain' })).case;
    const second = (await book.open({ ...SIGN_IN, source: 'mail:waiting' })).case;
    const waiting = await book.ask(second.id, {
      question: 'What happened?',
      options: ['Nothing'],
      allowsReply: true,
    });
    const around = (value: string): string => `Acme says the code is ${value}`;
    const paths: ReadonlyArray<readonly [string, (value: string) => Promise<unknown>]> = [
      ['The title', (value) => book.open({ ...SIGN_IN, source: 'mail:new', title: around(value) })],
      [
        'What was noticed',
        (value) => book.open({ ...SIGN_IN, source: 'mail:new', noticed: around(value) }),
      ],
      ['The source reference', (value) => book.open({ ...SIGN_IN, source: value })],
      [
        'The connector id',
        (value) => book.open({ ...SIGN_IN, source: 'mail:new', connectorId: value }),
      ],
      ['A note', (value) => book.note(plain.id, around(value))],
      ['The question', (value) => book.ask(plain.id, { question: around(value), options: ['Ok'] })],
      ['A choice', (value) => book.ask(plain.id, { question: 'Sure?', options: [value] })],
      ['The reply', (value) => book.answer(waiting.item.id, { reply: around(value) })],
      ['The resolution', (value) => book.close(plain.id, around(value))],
    ];
    for (const [what, attempt] of paths) {
      for (const value of SECRET_VALUES) {
        await expect(attempt(value), `${what}: ${value}`).rejects.toThrow(
          new RegExp(`^${what} looks like it contains a secret value`, 'u'),
        );
      }
    }
    await expect(book.note(plain.id, 'token: abc123')).rejects.toThrow(
      /Words such as password or token are fine/u,
    );
    // Nothing was written: no new case, the plain case untouched and open, the question still waiting.
    expect(await book.list()).toHaveLength(2);
    const after = (await book.get(plain.id))!;
    expect(after.state).toBe('open');
    expect(after.question).toBeUndefined();
    expect(after.history.map((event) => event.kind)).toEqual(['observed']);
    expect((await book.get(waiting.case.id))?.question?.feedItemId).toBe(waiting.item.id);
    expect((await goals.feedItem(waiting.item.id))?.question?.state).toBe('open');
    expect((await goals.feed()).filter((entry) => entry.kind === 'question')).toHaveLength(1);
  });

  it('holds a bounded number of open cases and frees a place when one closes', async () => {
    const { book } = makeWorld();
    const opened = [];
    for (let index = 0; index < 20; index += 1) {
      opened.push((await book.open({ ...SIGN_IN, source: `mail:${index}` })).case);
    }
    await expect(book.open({ ...SIGN_IN, source: 'mail:21' })).rejects.toThrow(
      /20 cases are open already/u,
    );
    // An item that already has a case is still found when the places are full.
    expect((await book.open({ ...SIGN_IN, source: 'mail:3' })).existing).toBe(true);
    await book.close(opened[0]!.id, 'Nothing to do.');
    expect((await book.open({ ...SIGN_IN, source: 'mail:21' })).existing).toBe(false);
  });

  it('keeps a bounded number of notes and of events, and always leaves room for the answer and the close', async () => {
    const { book } = makeWorld();
    const { case: opened } = await book.open(SIGN_IN);
    for (let index = 1; index < 30; index += 1) await book.note(opened.id, `Note ${index}`);
    await expect(book.note(opened.id, 'One more')).rejects.toThrow(/holds 30 notes/u);

    const other = (await book.open({ ...SIGN_IN, source: 'mail:other' })).case;
    let rounds = 0;
    for (;;) {
      try {
        const { item } = await book.ask(other.id, {
          question: `Round ${rounds}?`,
          options: ['Ok'],
        });
        await book.answer(item.id, { choice: 'Ok' });
        rounds += 1;
      } catch (error) {
        expect((error as Error).message).toMatch(/grown as far as it can/u);
        break;
      }
    }
    expect(rounds).toBeGreaterThan(10);
    const full = (await book.get(other.id))!;
    expect(full.history.length).toBeLessThan(100);
    const closed = await book.close(other.id, 'Settled.');
    expect(closed.history.at(-1)).toEqual(expect.objectContaining({ kind: 'closed' }));
    expect(closed.history.length).toBeLessThanOrEqual(100);
  });

  it('asks one question at a time, shows it in the feed with the notes as its evidence, and records it as asked', async () => {
    const { book, goals } = makeWorld();
    const { case: opened } = await book.open(SIGN_IN);
    await book.note(opened.id, 'The mail came from the address the service always uses.');
    const { case: asked, item } = await book.ask(opened.id, {
      question: 'Did you sign in just now?',
      options: ['Yes, it was me', 'No', 'Yes, it was me'],
    });
    expect(asked.question).toEqual({
      text: 'Did you sign in just now?',
      options: ['Yes, it was me', 'No'],
      allowsReply: false,
      askedAt: expect.any(String),
      feedItemId: item.id,
    });
    expect(item).toEqual(
      expect.objectContaining({
        kind: 'question',
        title: SIGN_IN.title,
        body: `- ${SIGN_IN.noticed}\n- The mail came from the address the service always uses.`,
        dismissed: false,
        question: {
          caseId: opened.id,
          text: 'Did you sign in just now?',
          options: ['Yes, it was me', 'No'],
          allowsReply: false,
          state: 'open',
        },
      }),
    );
    expect(await goals.feedItem(item.id)).toEqual(item);
    await expect(book.ask(opened.id, { question: 'And another?', options: ['A'] })).rejects.toThrow(
      /already has a question/u,
    );
    expect((await goals.feed()).filter((entry) => entry.kind === 'question')).toHaveLength(1);
  });

  it('offers a reply when there are no choices, and refuses a question nobody could answer', async () => {
    const { book } = makeWorld();
    const { case: opened } = await book.open(SIGN_IN);
    await expect(
      book.ask(opened.id, { question: 'Which device?', allowsReply: false }),
    ).rejects.toThrow(/needs choices, or must allow a reply/u);
    await expect(
      book.ask(opened.id, { question: 'Which?', options: ['1', '2', '3', '4', '5'] }),
    ).rejects.toThrow(/at most 4 choices/u);
    await expect(
      book.ask(opened.id, { question: 'Which?', options: ['x'.repeat(61)] }),
    ).rejects.toThrow(/choice is longer than 60/u);
    const { case: asked } = await book.ask(opened.id, { question: 'Which device?' });
    expect(asked.question).toEqual(expect.objectContaining({ options: [], allowsReply: true }));
  });

  it('records a chosen answer on the case and on its card, and leaves no question waiting', async () => {
    const { book, goals } = makeWorld();
    const { case: opened } = await book.open(SIGN_IN);
    await book.note(opened.id, 'Looked at the address.');
    const { item } = await book.ask(opened.id, {
      question: 'Did you sign in just now?',
      options: ['Yes, it was me', 'No'],
    });
    const answered = await book.answer(item.id, { choice: 'Yes, it was me' });
    expect(answered.case.question).toBeUndefined();
    expect(answered.case.state).toBe('open');
    expect(answered.case.history.map((event) => [event.kind, event.text])).toEqual([
      ['observed', SIGN_IN.noticed],
      ['noted', 'Looked at the address.'],
      ['asked', 'Did you sign in just now?'],
      ['answered', 'Yes, it was me'],
    ]);
    expect(answered.item.question).toEqual(
      expect.objectContaining({
        state: 'answered',
        answer: { choice: 'Yes, it was me', at: expect.any(String) },
      }),
    );
    expect((await goals.feedItem(item.id))?.question?.state).toBe('answered');
    expect(await book.get(opened.id)).toEqual(answered.case);
    // The case can be asked again once the question is answered.
    expect(
      (await book.ask(opened.id, { question: 'Anything else?', options: ['No'] })).case.question,
    ).toBeDefined();
  });

  it('refuses an answer that is not a choice, a reply the question does not allow, or both, or neither', async () => {
    const { book } = makeWorld();
    const { case: opened } = await book.open(SIGN_IN);
    const { item } = await book.ask(opened.id, { question: 'Sure?', options: ['Yes', 'No'] });
    await expect(book.answer(item.id, { choice: 'Maybe' })).rejects.toThrow(
      /not one of the choices/u,
    );
    await expect(book.answer(item.id, { reply: 'Maybe' })).rejects.toThrow(
      /takes one of its choices, not a reply/u,
    );
    await expect(book.answer(item.id, { choice: 'Yes', reply: 'Yes' })).rejects.toThrow(
      /one of the choices, or with a reply/u,
    );
    await expect(book.answer(item.id, {})).rejects.toThrow(/one of the choices, or with a reply/u);
    const stillOpen = (await book.get(opened.id))!;
    expect(stillOpen.question?.feedItemId).toBe(item.id);
    expect(stillOpen.history.map((event) => event.kind)).toEqual(['observed', 'asked']);
  });

  it('takes a reply in the person’s own words when the question allows one, bounded and without secrets', async () => {
    const { book } = makeWorld();
    const { case: opened } = await book.open(SIGN_IN);
    const { item } = await book.ask(opened.id, {
      question: 'What happened?',
      options: ['Nothing'],
      allowsReply: true,
    });
    await expect(book.answer(item.id, { reply: '   ' })).rejects.toThrow(/reply cannot be empty/u);
    await expect(book.answer(item.id, { reply: 'z'.repeat(1_001) })).rejects.toThrow(
      /reply is longer than 1000/u,
    );
    await expect(
      book.answer(item.id, { reply: 'my password: hunter2-very-secret' }),
    ).rejects.toThrow(/contains a secret value/u);
    const answered = await book.answer(item.id, { reply: '  I was on a train,\nso no.  ' });
    expect(answered.case.history.at(-1)).toEqual(
      expect.objectContaining({ kind: 'answered', text: 'I was on a train,\nso no.' }),
    );
    expect(answered.item.question?.answer).toEqual({
      reply: 'I was on a train,\nso no.',
      at: expect.any(String),
    });
  });

  it('refuses a second answer, an answer for a closed or missing case, and one for something that is not a question', async () => {
    const { book, goals } = makeWorld();
    const { case: opened } = await book.open(SIGN_IN);
    const { item } = await book.ask(opened.id, { question: 'Sure?', options: ['Yes', 'No'] });
    await book.answer(item.id, { choice: 'Yes' });
    await expect(book.answer(item.id, { choice: 'No' })).rejects.toThrow(/already answered/u);
    expect((await book.get(opened.id))!.history.filter((e) => e.kind === 'answered')).toHaveLength(
      1,
    );

    const second = (await book.open({ ...SIGN_IN, source: 'mail:2' })).case;
    const closing = await book.ask(second.id, { question: 'Sure?', options: ['Yes'] });
    await book.close(second.id, 'Settled without asking.');
    await expect(book.answer(closing.item.id, { choice: 'Yes' })).rejects.toThrow(
      /closed before this question was answered/u,
    );
    expect((await goals.feedItem(closing.item.id))?.question?.state).toBe('withdrawn');

    const report = await goals.post({ kind: 'report', title: 'Report', body: 'Nothing new.' });
    await expect(book.answer(report.id, { choice: 'Yes' })).rejects.toThrow(/No question/u);
    await expect(book.answer('feed-nothing', { choice: 'Yes' })).rejects.toThrow(/No question/u);
  });

  it('refuses an answer when the case is gone, closed or moved on behind a card that still looks open, and withdraws that card so it can be dismissed', async () => {
    const cases = createMemoryCaseStore();
    const { book, goals } = world(cases, createMemoryGoalStore());
    const { case: opened } = await book.open(SIGN_IN);
    const { item } = await book.ask(opened.id, { question: 'Sure?', options: ['Yes'] });
    // A card whose case was closed by a write that did not reach the feed, and one with no case at all.
    await cases.put({ ...opened, state: 'closed' });
    await expect(goals.dismiss(item.id)).rejects.toThrow(/Answer the question/u);
    await expect(book.answer(item.id, { choice: 'Yes' })).rejects.toThrow(/case is closed/u);
    await expectCleared(goals, item.id);
    const orphan = await goals.post({
      kind: 'question',
      title: 'Orphan',
      body: '',
      question: {
        caseId: 'case-gone',
        text: 'Sure?',
        options: ['Yes'],
        allowsReply: false,
        state: 'open',
      },
    });
    await expect(book.answer(orphan.id, { choice: 'Yes' })).rejects.toThrow(
      /case for this question is gone/u,
    );
    await expectCleared(goals, orphan.id);
    // A case that no longer waits on this card, as after an answer that did not reach the feed.
    const other = (await book.open({ ...SIGN_IN, source: 'mail:other' })).case;
    const stuck = await book.ask(other.id, { question: 'Sure?', options: ['Yes'] });
    const { question: _waiting, ...notWaiting } = stuck.case;
    await cases.put(notWaiting);
    await expect(book.answer(stuck.item.id, { choice: 'Yes' })).rejects.toThrow(
      /no longer waiting for an answer/u,
    );
    await expectCleared(goals, stuck.item.id);
  });

  it('closes a case with a resolution, withdraws a waiting question, and refuses to change a closed case', async () => {
    const { book, goals } = makeWorld();
    const { case: opened } = await book.open(SIGN_IN);
    const { item } = await book.ask(opened.id, { question: 'Sure?', options: ['Yes'] });
    const closed = await book.close(opened.id, '  Handled elsewhere.  ');
    expect(closed.state).toBe('closed');
    expect(closed.question).toBeUndefined();
    expect(closed.history.at(-1)).toEqual(
      expect.objectContaining({ kind: 'closed', text: 'Handled elsewhere.' }),
    );
    expect((await goals.feedItem(item.id))?.question?.state).toBe('withdrawn');
    await expect(book.note(opened.id, 'Late note')).rejects.toThrow(/case is closed/u);
    await expect(book.ask(opened.id, { question: 'Again?' })).rejects.toThrow(/case is closed/u);
    await expect(book.close(opened.id, 'Again.')).rejects.toThrow(/case is closed/u);
    await expect(book.close(opened.id, ' ')).rejects.toThrow(CaseRefusedError);
    await expect(book.note('case-nothing', 'x')).rejects.toThrow(/No case case-nothing/u);
  });

  it('lists open cases first and the ones closed last after them, newest first', async () => {
    const { book } = makeWorld();
    const a = (await book.open({ ...SIGN_IN, source: 'a' })).case;
    const b = (await book.open({ ...SIGN_IN, source: 'b' })).case;
    const c = (await book.open({ ...SIGN_IN, source: 'c' })).case;
    await book.close(b.id, 'Done.');
    await book.note(a.id, 'Touched last.');
    expect((await book.list()).map((entry) => entry.id)).toEqual([a.id, c.id, b.id]);
    expect(await book.list(2)).toHaveLength(2);
    expect(await book.get('constructor')).toBeUndefined();
  });

  it('keeps an open question from being dismissed, and lets an answered or withdrawn one go', async () => {
    const { book, goals } = makeWorld();
    const { case: opened } = await book.open(SIGN_IN);
    const { item } = await book.ask(opened.id, { question: 'Sure?', options: ['Yes'] });
    await expect(goals.dismiss(item.id)).rejects.toThrow(GoalRefusedError);
    await expect(goals.dismiss(item.id)).rejects.toThrow(/Answer the question/u);
    await book.answer(item.id, { choice: 'Yes' });
    await goals.dismiss(item.id);
    expect((await goals.feedItem(item.id))?.dismissed).toBe(true);
    expect((await goals.feed()).find((entry) => entry.id === item.id)?.question?.state).toBe(
      'answered',
    );
  });
});

describe('a write that fails half way', () => {
  it('withdraws the card it posted when the case cannot be written, so no open question is left behind', async () => {
    const underlying = createMemoryCaseStore();
    let failing = false;
    const cases: ICaseStore = {
      ...underlying,
      put: async (item) => {
        if (failing) throw new Error('disk full');
        await underlying.put(item);
      },
    };
    const { book, goals } = world(cases, createMemoryGoalStore());
    const { case: opened } = await book.open(SIGN_IN);
    failing = true;
    await expect(book.ask(opened.id, { question: 'Sure?', options: ['Yes'] })).rejects.toThrow(
      /disk full/u,
    );
    failing = false;
    const cards = (await goals.feed()).filter((entry) => entry.kind === 'question');
    expect(cards.map((entry) => entry.question?.state)).toEqual(['withdrawn']);
    await expectCleared(goals, cards[0]!.id);
    // The case is as it was, and can ask again.
    expect((await book.get(opened.id))?.question).toBeUndefined();
    const again = await book.ask(opened.id, { question: 'Sure?', options: ['Yes'] });
    expect(again.item.question?.state).toBe('open');
  });

  it('closes the case before withdrawing its card, so a failure of the withdrawal leaves a card that clears when answered', async () => {
    const underlying = createMemoryGoalStore();
    let failing = false;
    const feed: IGoalStore = {
      ...underlying,
      putFeedItem: async (item) => {
        if (failing) throw new Error('disk full');
        await underlying.putFeedItem(item);
      },
    };
    const { book, goals } = world(createMemoryCaseStore(), feed);
    const { case: opened } = await book.open(SIGN_IN);
    const { item } = await book.ask(opened.id, { question: 'Sure?', options: ['Yes'] });
    failing = true;
    await expect(book.close(opened.id, 'Settled.')).rejects.toThrow(/disk full/u);
    failing = false;
    // The case is closed with no question waiting; the card still looks open until it is answered.
    const closed = (await book.get(opened.id))!;
    expect(closed.state).toBe('closed');
    expect(closed.question).toBeUndefined();
    expect((await goals.feedItem(item.id))?.question?.state).toBe('open');
    await expect(book.answer(item.id, { choice: 'Yes' })).rejects.toThrow(/case is closed/u);
    await expectCleared(goals, item.id);
  });
});

describe('cases in an owner-only file', () => {
  it('keeps a case, its question and its history across a restart, and the answer after it continues the case', async () => {
    const caseDir = directory();
    const feedDir = directory();
    const before = world(createFileCaseStore(caseDir), createFileGoalStore(feedDir));
    const { case: opened } = await before.book.open(SIGN_IN);
    await before.book.note(opened.id, 'Looked at the address.');
    const { item } = await before.book.ask(opened.id, {
      question: 'Did you sign in just now?',
      options: ['Yes, it was me', 'No'],
    });

    const after = world(createFileCaseStore(caseDir), createFileGoalStore(feedDir));
    const reopened = (await after.book.get(opened.id))!;
    expect(reopened.question).toEqual(expect.objectContaining({ feedItemId: item.id }));
    expect(reopened.history.map((event) => event.kind)).toEqual(['observed', 'noted', 'asked']);
    expect((await after.goals.feedItem(item.id))?.question?.state).toBe('open');
    expect((await after.book.open(SIGN_IN)).existing).toBe(true);

    const answered = await after.book.answer(item.id, { choice: 'No' });
    expect(answered.case.history.map((event) => event.kind)).toEqual([
      'observed',
      'noted',
      'asked',
      'answered',
    ]);
    const again = world(createFileCaseStore(caseDir), createFileGoalStore(feedDir));
    expect((await again.book.get(opened.id))?.history.at(-1)).toEqual(
      expect.objectContaining({ kind: 'answered', text: 'No' }),
    );
  });

  it('writes cases.json readable by the owner alone', async () => {
    const dir = directory();
    const { book } = world(createFileCaseStore(dir), createMemoryGoalStore());
    const { case: opened } = await book.open(SIGN_IN);
    expect(JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8'))[opened.id].title).toBe(
      SIGN_IN.title,
    );
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'cases.json')).mode & 0o777).toBe(0o600);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
  });

  it('keeps every open case and only the newest closed ones, and refuses an id that is not a case id', async () => {
    const store = createFileCaseStore(directory());
    const base = {
      title: 't',
      origin: { source: 's' },
      notes: [],
      history: [],
      createdAt: '2026-11-16T00:00:00.000Z',
    } as const;
    await store.put({
      ...base,
      id: 'case-open',
      state: 'open',
      updatedAt: '2026-11-15T00:00:00.000Z',
    });
    for (let index = 0; index < 502; index += 1) {
      await store.put({
        ...base,
        id: `case-closed${index}`,
        state: 'closed',
        updatedAt: new Date(Date.UTC(2026, 10, 16, 0, 0, index)).toISOString(),
      });
    }
    const kept = await store.list();
    expect(kept).toHaveLength(501);
    expect(kept.some((entry) => entry.id === 'case-open')).toBe(true);
    expect(kept.some((entry) => entry.id === 'case-closed0')).toBe(false);
    expect(kept.some((entry) => entry.id === 'case-closed501')).toBe(true);
    await expect(
      store.put({ ...base, id: '../escape', state: 'open', updatedAt: base.createdAt }),
    ).rejects.toThrow(/Invalid case id/u);
    expect(await store.get('__proto__')).toBeUndefined();
  });

  it('never drops a question that waits in the feed, however many reports follow it', async () => {
    const feed = createFileGoalStore(directory());
    const { book } = world(createMemoryCaseStore(), feed);
    const { case: opened } = await book.open(SIGN_IN);
    const { item } = await book.ask(opened.id, { question: 'Sure?', options: ['Yes'] });
    for (let index = 0; index < 505; index += 1) {
      await feed.putFeedItem({
        id: `feed-report${index}`,
        at: new Date(Date.UTC(2027, 0, 1, 0, 0, index)).toISOString(),
        kind: 'report',
        title: 'Report',
        body: 'Nothing new.',
        dismissed: false,
      });
    }
    expect((await feed.getFeedItem(item.id))?.question?.state).toBe('open');
    expect(await feed.listFeed(1_000)).toHaveLength(500);
  });
});

describe('case tools', () => {
  function tools() {
    const { book, goals } = world(createMemoryCaseStore(), createMemoryGoalStore());
    const byName = Object.fromEntries(
      createCaseTools(book).map((tool) => [tool.schema.name, tool]),
    );
    /** What the model is given back: the tool's result, which arrives as JSON text. */
    const call = async (name: string, args: TToolParameters): Promise<Record<string, unknown>> =>
      JSON.parse(
        (await byName[name]!.execute(args, { toolName: name, parameters: {} })).data as string,
      );
    return { call, goals, book };
  }

  it('opens a case, notes, asks and closes it, and gives a refusal to the model as a message', async () => {
    const { call, goals, book } = tools();
    const opened = await call('CaseOpen', {
      title: SIGN_IN.title,
      noticed: SIGN_IN.noticed,
      source: SIGN_IN.source,
      connector: SIGN_IN.connectorId,
    });
    const id = opened['opened'] as string;
    expect((await book.get(id))?.origin).toEqual({
      source: SIGN_IN.source,
      connectorId: SIGN_IN.connectorId,
    });
    expect(await call('CaseNote', { id, text: 'Looked at the address.' })).toEqual({ noted: id });
    const asked = await call('CaseAsk', {
      id,
      question: 'Did you sign in just now?',
      options: ['Yes', 'No'],
    });
    expect(asked['asked']).toBe(id);
    expect((await goals.feedItem(asked['feedItem'] as string))?.question?.text).toBe(
      'Did you sign in just now?',
    );
    expect(await call('CaseAsk', { id, question: 'Again?' })).toEqual({
      error: 'This case already has a question waiting for the person',
    });
    expect(await call('CaseClose', { id, resolution: 'Confirmed by the person.' })).toEqual({
      closed: id,
    });
    expect(await call('CaseNote', { id, text: 'Late' })).toEqual({ error: 'This case is closed' });
  });

  it('gives the model a refusal that says the words are fine and only a value is not, and keeps a note about a password', async () => {
    const { call } = tools();
    const opened = await call('CaseOpen', {
      title: SIGN_IN.title,
      noticed: SIGN_IN.noticed,
      source: SIGN_IN.source,
    });
    const id = opened['opened'] as string;
    expect(
      await call('CaseNote', { id, text: 'Acme says a password reset was requested.' }),
    ).toEqual({
      noted: id,
    });
    const refused = await call('CaseNote', { id, text: 'The reset code is token: abc123' });
    expect(refused).toEqual({
      error: expect.stringMatching(
        /^A note looks like it contains a secret value, so it is not kept in a case\. Words such as password or token are fine/u,
      ),
    });
  });

  it('tells the model what became of an item that already has a case, instead of opening another', async () => {
    const { call } = tools();
    const first = await call('CaseOpen', {
      title: SIGN_IN.title,
      noticed: SIGN_IN.noticed,
      source: SIGN_IN.source,
    });
    const id = first['opened'] as string;
    await call('CaseAsk', { id, question: 'Was it you?', options: ['Yes'] });
    expect(await call('CaseOpen', { title: 'x', noticed: 'y', source: SIGN_IN.source })).toEqual({
      existing: id,
      state: 'open',
      waitingForThePerson: 'Was it you?',
    });
    await call('CaseClose', { id, resolution: 'It was them.' });
    expect(await call('CaseOpen', { title: 'x', noticed: 'y', source: SIGN_IN.source })).toEqual({
      existing: id,
      state: 'closed',
      resolution: 'It was them.',
    });
  });

  it('are inspect-class: they change only the agent’s own record, so a read-only run may keep a case', () => {
    clearRegisteredToolProfiles();
    tools();
    for (const name of Object.values(CASE_TOOL_NAMES)) {
      expect(getToolPermissionProfile(name).riskClass, name).toBe('inspect');
      expect(getToolPermissionProfile(name).consequential, name).toBeUndefined();
      expect(evaluatePermission(name, {}, 'plan', {}), name).toBe('auto');
      expect(evaluatePermission(name, {}, 'default', {}), name).toBe('auto');
    }
  });
});
