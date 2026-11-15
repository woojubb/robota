/**
 * Cases in the personal agent: the agent opens one from a chat turn or a read-only goal run, asks the
 * person a question that shows in the feed, and the person's answer is recorded over the HTTP API.
 * The turn the agent takes on an answered case is in `case-turns.test.ts`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CaseBook,
  GoalBook,
  createMemoryCaseStore,
  createMemoryGoalStore,
} from '@robota-sdk/agent-product/personal';

import { createPersonalApi } from '../personal-api.js';
import { offeredTools, toolResults } from './scripted-model.js';
import { createFixtureWebRoot, startHarness } from './harness.js';

import type { IAskInput, ICase } from '@robota-sdk/agent-product/personal';
import type { IPersonalApiOptions } from '../personal-api.js';
import type { IHarness } from './harness.js';

const dirs: string[] = [];
let harness: IHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface IClient {
  get(path: string): Promise<{ status: number; body: any }>;
  send(
    method: string,
    path: string,
    body?: unknown,
    options?: { cookie?: boolean; write?: boolean },
  ): Promise<{ status: number; body: any }>;
}

/** Log in with the access code the way a browser does, then call the API with the cookie it got. */
async function client(started: IHarness): Promise<IClient> {
  const gui = started.local.gui!;
  const login = await fetch(new URL('/__monitor_login', gui.url), {
    method: 'POST',
    body: new URLSearchParams({ code: gui.accessCode }),
    redirect: 'manual',
  });
  const base = new URL(`${login.headers.get('location')!}api/`, gui.url);
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const parse = async (response: Response) => ({
    status: response.status,
    body: await response.json().catch(() => null),
  });
  return {
    get: async (path) => parse(await fetch(new URL(path, base), { headers: { cookie } })),
    send: async (method, path, body, { cookie: withCookie = true, write = true } = {}) =>
      parse(
        await fetch(new URL(path, base), {
          method,
          headers: {
            ...(withCookie && { cookie }),
            'content-type': 'application/json',
            ...(write && { 'x-robota-api': '1' }),
          },
          ...(body !== undefined && { body: JSON.stringify(body) }),
        }),
      ),
  };
}

const SIGN_IN = {
  title: 'New sign-in to your account',
  noticed: 'A mail from Example says a new sign-in happened from Seoul at 10:02.',
  source: 'mail:message-1',
  connectorId: 'connector-mail-1',
};

/** A case with a question waiting in the feed, made through the agent's own book. */
async function ask(
  started: IHarness,
  question: IAskInput = {
    question: 'Did you sign in just now?',
    options: ['Yes, it was me', 'No'],
  },
  source = SIGN_IN.source,
) {
  const { cases } = started.capabilities;
  const { case: opened } = await cases.open({ ...SIGN_IN, source });
  const { item } = await cases.ask(opened.id, question);
  return { opened, item };
}

describe('the agent keeps a case from a chat turn', () => {
  it('offers the case tools, and puts the question a turn asked in the feed with its evidence', async () => {
    harness = await startHarness();
    harness.model.script(
      {
        tool: 'CaseOpen',
        args: { title: SIGN_IN.title, noticed: SIGN_IN.noticed, source: 'chat:1' },
      },
      (request) => ({
        tool: 'CaseAsk',
        args: {
          id: /case-[a-z0-9]+/u.exec(toolResults(request).at(-1) ?? '')![0],
          question: 'Did you sign in just now?',
          options: ['Yes, it was me', 'No'],
        },
      }),
      { text: 'I asked you in your feed.' },
    );
    const turn = await harness.submit('Keep a case on the sign-in mail.');
    expect(turn.text).toContain('I asked you in your feed.');
    expect(offeredTools(harness.model.requests[0]!)).toEqual(
      expect.arrayContaining(['CaseOpen', 'CaseNote', 'CaseAsk', 'CaseClose']),
    );

    const [opened] = await harness.capabilities.cases.list();
    expect(opened?.question?.text).toBe('Did you sign in just now?');
    const feed = await harness.capabilities.goals.feed();
    expect(feed).toEqual([
      expect.objectContaining({
        kind: 'question',
        title: SIGN_IN.title,
        body: `- ${SIGN_IN.noticed}`,
        question: expect.objectContaining({ caseId: opened!.id, state: 'open' }),
      }),
    ]);
  });
});

describe('a read-only goal run', () => {
  it('may keep a case, which changes only the agent’s own record, though it may change nothing else', async () => {
    harness = await startHarness();
    const goal = await harness.capabilities.goals.create({
      title: 'Watch the mailbox',
      instructions: 'Look at what came in.',
      readOnly: true,
    });
    harness.model.script(
      {
        tool: 'CaseOpen',
        args: { title: SIGN_IN.title, noticed: SIGN_IN.noticed, source: 'run:1' },
      },
      { tool: 'IdeaAdd', args: { text: 'A thought', origin: 'agent' } },
      { text: 'Kept a case.' },
    );
    await harness.capabilities.runner()!.runDue();
    await harness.capabilities.runner()!.settled();

    const [run] = await harness.capabilities.goals.runs(goal.id);
    expect(run?.actions.map((action) => [action.tool, action.outcome])).toEqual([
      ['CaseOpen', 'done'],
      ['IdeaAdd', 'denied'],
    ]);
    expect(await harness.capabilities.cases.list()).toHaveLength(1);
    expect(await harness.capabilities.ideas.list()).toEqual([]);
  });
});

describe('answering a question over the personal API', () => {
  async function started() {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    return { api: await client(harness), harness };
  }

  it('lists the cases and reads one, newest open first', async () => {
    const { api, harness } = await started();
    const { opened } = await ask(harness);
    expect((await api.get('cases')).body.cases.map((entry: ICase) => entry.id)).toEqual([
      opened.id,
    ]);
    const read = (await api.get(`cases/${opened.id}`)).body.case as ICase;
    expect(read.title).toBe(SIGN_IN.title);
    expect(read.history.map((event) => event.kind)).toEqual(['observed', 'asked']);
    expect((await api.get('cases/case-nothing')).status).toBe(404);
  });

  it('records a chosen answer on the case and the card, and returns the case', async () => {
    const { api, harness } = await started();
    const { opened, item } = await ask(harness);
    const answered = await api.send('POST', `feed/${item.id}/answer`, { choice: 'No' });
    expect(answered.status).toBe(200);
    expect(answered.body.case.question).toBeUndefined();
    expect(answered.body.case.history.map((event: any) => [event.kind, event.text])).toEqual([
      ['observed', SIGN_IN.noticed],
      ['asked', 'Did you sign in just now?'],
      ['answered', 'No'],
    ]);
    expect(answered.body.item.question).toEqual(
      expect.objectContaining({
        state: 'answered',
        answer: { choice: 'No', at: expect.any(String) },
      }),
    );
    const feed = (await api.get('feed')).body.items;
    expect(feed.find((entry: any) => entry.id === item.id).question.state).toBe('answered');
    expect((await harness.capabilities.cases.get(opened.id))?.question).toBeUndefined();
  });

  it('refuses an answer that is not one of the choices, and a reply to a question that takes none', async () => {
    const { api, harness } = await started();
    const { opened, item } = await ask(harness);
    for (const body of [
      { choice: 'Maybe' },
      { reply: 'Maybe' },
      {},
      { choice: 'No', reply: 'x' },
    ]) {
      const refused = await api.send('POST', `feed/${item.id}/answer`, body);
      expect(refused.status, JSON.stringify(body)).toBe(400);
      expect(typeof refused.body.error).toBe('string');
    }
    expect((await api.send('POST', `feed/${item.id}/answer`, { choice: 5 })).status).toBe(400);
    expect((await harness.capabilities.cases.get(opened.id))?.question?.feedItemId).toBe(item.id);
  });

  it('takes a reply in the person’s words only where the question allows one', async () => {
    const { api, harness } = await started();
    const { item } = await ask(harness, {
      question: 'Which device?',
      options: ['This one'],
      allowsReply: true,
    });
    expect((await api.send('POST', `feed/${item.id}/answer`, { reply: '   ' })).status).toBe(400);
    const answered = await api.send('POST', `feed/${item.id}/answer`, { reply: 'My old phone' });
    expect(answered.status).toBe(200);
    expect(answered.body.item.question.answer).toEqual({
      reply: 'My old phone',
      at: expect.any(String),
    });
    expect(answered.body.case.history.at(-1)).toEqual(
      expect.objectContaining({ kind: 'answered', text: 'My old phone' }),
    );
  });

  it('refuses a second answer, an answer after the case closed, and an item that is not a question', async () => {
    const { api, harness } = await started();
    const { item } = await ask(harness);
    expect(
      (await api.send('POST', `feed/${item.id}/answer`, { choice: 'Yes, it was me' })).status,
    ).toBe(200);
    const twice = await api.send('POST', `feed/${item.id}/answer`, { choice: 'No' });
    expect(twice.status).toBe(400);
    expect(twice.body.error).toMatch(/already answered/u);

    const second = await ask(harness, undefined, 'mail:message-2');
    await harness.capabilities.cases.close(second.opened.id, 'Handled elsewhere.');
    const closed = await api.send('POST', `feed/${second.item.id}/answer`, { choice: 'No' });
    expect(closed.status).toBe(400);
    expect(closed.body.error).toMatch(/closed/u);

    const report = await harness.capabilities.goals.post({
      kind: 'report',
      title: 'Report',
      body: 'Nothing new.',
    });
    expect((await api.send('POST', `feed/${report.id}/answer`, { choice: 'No' })).status).toBe(400);
    expect((await api.send('POST', 'feed/feed-nothing/answer', { choice: 'No' })).status).toBe(404);
  });

  it('never takes a question for an approval', async () => {
    const { api, harness } = await started();
    const { item } = await ask(harness);
    for (const action of ['approve', 'deny']) {
      expect((await api.send('POST', `feed/${item.id}/${action}`)).status, action).toBe(400);
    }
    expect((await harness.capabilities.goals.feedItem(item.id))?.question?.state).toBe('open');
  });

  it('answers only for the browser that holds the access cookie and sends the write header', async () => {
    const { api, harness } = await started();
    const { opened, item } = await ask(harness);
    const path = `feed/${item.id}/answer`;
    expect((await api.send('POST', path, { choice: 'No' }, { cookie: false })).status).toBe(403);
    expect((await api.send('POST', path, { choice: 'No' }, { write: false })).status).toBe(403);
    expect((await harness.capabilities.cases.get(opened.id))?.question?.feedItemId).toBe(item.id);
    expect((await harness.capabilities.goals.feedItem(item.id))?.question?.state).toBe('open');
  });

  it('keeps an open question in the feed until it is answered, then lets the person dismiss the card', async () => {
    const { api, harness } = await started();
    const { item } = await ask(harness);
    const refused = await api.send('POST', `feed/${item.id}/dismiss`);
    expect(refused.status).toBe(400);
    await api.send('POST', `feed/${item.id}/answer`, { choice: 'No' });
    expect((await api.send('POST', `feed/${item.id}/dismiss`)).status).toBe(200);
    // The agent's turn on the case may have reported by now; the dismissed card is gone either way.
    expect((await api.get('feed')).body.items.map((entry: any) => entry.id)).not.toContain(item.id);
  });
});

describe('the seam an answer leaves for what continues the case', () => {
  function apiWith(onCaseAnswered: (answered: ICase) => void) {
    const goals = new GoalBook({ store: createMemoryGoalStore() });
    const cases = new CaseBook({ store: createMemoryCaseStore(), feed: goals });
    const api = createPersonalApi({
      goals,
      cases,
      onCaseAnswered,
    } as unknown as IPersonalApiOptions);
    const answer = (id: string, body: unknown) =>
      api({
        method: 'POST',
        path: `/feed/${id}/answer`,
        segments: ['feed', id, 'answer'],
        query: new URLSearchParams(),
        body,
      });
    return { cases, answer };
  }

  it('is called once with the case after the answer is recorded, not before and not for a refused answer', async () => {
    const seen: ICase[] = [];
    const { cases, answer } = apiWith((answered) => seen.push(answered));
    const { case: opened } = await cases.open(SIGN_IN);
    const { item } = await cases.ask(opened.id, { question: 'Sure?', options: ['Yes'] });
    expect((await answer(item.id, { choice: 'Maybe' })).status).toBe(400);
    expect(seen).toEqual([]);
    expect((await answer(item.id, { choice: 'Yes' })).status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.history.at(-1)).toEqual(expect.objectContaining({ kind: 'answered' }));
    expect(seen[0]).toEqual(await cases.get(opened.id));
    expect((await answer(item.id, { choice: 'Yes' })).status).toBe(400);
    expect(seen).toHaveLength(1);
  });

  it('cannot fail an answer that is already recorded', async () => {
    const { cases, answer } = apiWith(() => {
      throw new Error('the case turn failed to start');
    });
    const { case: opened } = await cases.open(SIGN_IN);
    const { item } = await cases.ask(opened.id, { question: 'Sure?', options: ['Yes'] });
    expect((await answer(item.id, { choice: 'Yes' })).status).toBe(200);
    expect((await cases.get(opened.id))?.history.at(-1)?.kind).toBe('answered');
  });
});

describe('a restart in the middle of a case', () => {
  it('keeps the case, its question and its history, and the answer after the restart is recorded', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'personal-agent-cases-'));
    dirs.push(stateDir);
    const first = await startHarness({ stateDir, gui: true, webRoot: createFixtureWebRoot() });
    const { opened, item } = await ask(first);
    await first.capabilities.cases.note(opened.id, 'Looked at the address.');
    await first.close();

    harness = await startHarness({ stateDir, gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    const read = (await api.get(`cases/${opened.id}`)).body.case as ICase;
    expect(read.question?.feedItemId).toBe(item.id);
    expect(read.history.map((event) => event.kind)).toEqual(['observed', 'asked', 'noted']);
    const open = (await api.get('feed')).body.items.find((entry: any) => entry.id === item.id);
    expect(open.question.state).toBe('open');

    const answered = await api.send('POST', `feed/${item.id}/answer`, { choice: 'No' });
    expect(answered.status).toBe(200);
    expect(answered.body.case.history.map((event: any) => event.kind)).toEqual([
      'observed',
      'asked',
      'noted',
      'answered',
    ]);
  });
});
