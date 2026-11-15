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

const SIGN_IN = {
  title: 'New sign-in to your account',
  noticed: 'A mail from Example says a new sign-in happened from Seoul at 10:02.',
  source: 'mail:message-1',
  connectorId: 'connector-mail-1',
};

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
    ).rejects.toThrow(/looks like a secret/u);
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

  it('refuses an answer when the case is gone or closed behind a card that still looks open', async () => {
    const cases = createMemoryCaseStore();
    const { book, goals } = world(cases, createMemoryGoalStore());
    const { case: opened } = await book.open(SIGN_IN);
    const { item } = await book.ask(opened.id, { question: 'Sure?', options: ['Yes'] });
    // A card whose case was closed by a write that did not reach the feed, and one with no case at all.
    await cases.put({ ...opened, state: 'closed' });
    await expect(book.answer(item.id, { choice: 'Yes' })).rejects.toThrow(/case is closed/u);
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
