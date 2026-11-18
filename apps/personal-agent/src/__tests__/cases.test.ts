/**
 * Cases in the personal agent: the agent opens one from a chat turn or a read-only goal run, asks the
 * person a question that shows in the feed, and the person's answer is recorded over the HTTP API.
 * The turn the agent takes on an answered case is in `case-turns.test.ts`.
 */
import {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CaseBook,
  ConnectorBook,
  GoalBook,
  createMemoryCaseStore,
  createMemoryConnectorStore,
  createFileConnectorStore,
  createFileCaseStore,
  createMemoryGoalStore,
} from '@robota-sdk/agent-product/personal';

import { createPersonalApi } from '../personal-api.js';
import { createCaseConnectorBindings } from '../case-connector-binding.js';
import { createCaseActionScope } from '../connectors/case-action-scope.js';
import { offeredTools, toolResults } from './scripted-model.js';
import { createFixtureWebRoot, startHarness } from './harness.js';

import type { IAskInput, ICase, ICaseStore } from '@robota-sdk/agent-product/personal';
import type { IPersonalApiOptions } from '../personal-api.js';
import type { ICaseActionSnapshot } from '../case-action.js';
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

describe('case connector authority', () => {
  it('serializes competing answers before either instance reads the case', async () => {
    harness = await startHarness();
    const other = await startHarness({ stateDir: harness.stateDir });
    const { case: opened } = await harness.capabilities.cases.open(SIGN_IN);
    const { item } = await harness.capabilities.cases.ask(opened.id, {
      question: 'Was it you?',
      options: ['Yes', 'No'],
    });
    const store = (other.capabilities.cases as unknown as { store: ICaseStore }).store;
    const get = store.get.bind(store);
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const spy = vi.spyOn(store, 'get').mockImplementation(async (id) => {
      const found = await get(id);
      reached();
      await gate;
      return found;
    });
    const first = other.capabilities.cases.answer(item.id, { choice: 'No' });
    let second: Promise<unknown> | undefined;
    try {
      await waiting;
      second = harness.capabilities.cases.answer(item.id, { choice: 'Yes' });
      const early = await Promise.race([
        second.then(
          () => true,
          () => true,
        ),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);
      expect(early).toBe(false);
      release();
      await first;
      await expect(second).rejects.toThrow(/already answered/u);
      expect((await harness.capabilities.cases.get(opened.id))?.history.at(-1)).toMatchObject({
        kind: 'answered',
        text: 'No',
      });
      expect((await harness.capabilities.goals.feedItem(item.id))?.question?.answer?.choice).toBe(
        'No',
      );
    } finally {
      release();
      await Promise.allSettled([first, ...(second === undefined ? [] : [second])]);
      spy.mockRestore();
      await other.close();
    }
  });

  it('keeps another answer from withdrawing a card between the case and feed writes', async () => {
    harness = await startHarness();
    const other = await startHarness({ stateDir: harness.stateDir });
    const { case: opened } = await harness.capabilities.cases.open(SIGN_IN);
    const { item } = await harness.capabilities.cases.ask(opened.id, {
      question: 'Was it you?',
      options: ['Yes', 'No'],
    });
    const goals = harness.capabilities.goals;
    const answerQuestion = goals.answerQuestion.bind(goals);
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const spy = vi.spyOn(goals, 'answerQuestion').mockImplementation(async (...args) => {
      reached();
      await gate;
      return answerQuestion(...args);
    });
    const accepted = harness.capabilities.cases.answer(item.id, { choice: 'Yes' });
    let competing: Promise<unknown> | undefined;
    try {
      await waiting;
      competing = other.capabilities.cases.answer(item.id, { choice: 'No' });
      const early = await Promise.race([
        competing.then(
          () => true,
          () => true,
        ),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);
      expect(early).toBe(false);
      release();
      await accepted;
      await expect(competing).rejects.toThrow(/already answered/u);
      expect((await harness.capabilities.cases.get(opened.id))?.history.at(-1)).toMatchObject({
        kind: 'answered',
        text: 'Yes',
      });
      expect((await goals.feedItem(item.id))?.question).toMatchObject({
        state: 'answered',
        answer: { choice: 'Yes' },
      });
    } finally {
      release();
      await Promise.allSettled([accepted, ...(competing === undefined ? [] : [competing])]);
      spy.mockRestore();
      await other.close();
    }
  });

  it('clears a closed case binding even if updating its feed card fails', async () => {
    harness = await startHarness();
    const book = new ConnectorBook({
      store: createFileConnectorStore(join(harness.stateDir, 'connectors')),
    });
    const connector = await book.create({
      title: 'Notes',
      kind: 'notes',
      protocol: 'mcp',
      endpoint: 'https://notes.example/mcp',
      auth: 'none',
    });
    const { case: opened } = await harness.capabilities.cases.open(SIGN_IN);
    await harness.capabilities.cases.ask(opened.id, {
      question: 'Was it you?',
      options: ['Yes', 'No'],
    });
    const path = ['cases', opened.id, 'connector'];
    const get = await harness.capabilities.api({
      method: 'GET',
      path: `/${path.join('/')}`,
      segments: path,
      query: new URLSearchParams(),
      body: undefined,
    });
    const revision = (get.body as { binding: { revision: string } }).binding.revision;
    await harness.capabilities.api({
      method: 'POST',
      path: `/${path.join('/')}`,
      segments: path,
      query: new URLSearchParams(),
      body: { connectorId: connector.id, revision },
    });
    const withdrawal = vi
      .spyOn(harness.capabilities.goals, 'withdrawQuestion')
      .mockRejectedValueOnce(new Error('feed unavailable'));
    try {
      await expect(harness.capabilities.cases.close(opened.id, 'Settled.')).rejects.toThrow(
        'feed unavailable',
      );
      expect((await harness.capabilities.cases.get(opened.id))?.state).toBe('closed');
      const saved: unknown = JSON.parse(
        readFileSync(
          join(harness.stateDir, 'case-connector-bindings', `${opened.id}.json`),
          'utf8',
        ),
      );
      expect(saved).not.toHaveProperty('connectorId');
    } finally {
      withdrawal.mockRestore();
    }
  });

  it('releases both authority locks before waiting for an admitted response', async () => {
    harness = await startHarness();
    const book = new ConnectorBook({
      store: createFileConnectorStore(join(harness.stateDir, 'connectors')),
    });
    const connector = await book.create({
      title: 'Notes',
      kind: 'notes',
      protocol: 'mcp',
      endpoint: 'https://notes.example/mcp',
      auth: 'none',
    });
    const { case: opened } = await harness.capabilities.cases.open(SIGN_IN);
    const scope = createCaseActionScope(join(harness.stateDir, 'case-action-scope'));
    const bindings = createCaseConnectorBindings({
      directory: join(harness.stateDir, 'case-connector-bindings'),
      cases: harness.capabilities.cases,
      connectors: book,
      scope,
      writes: createCaseActionScope(join(harness.stateDir, 'cases')),
    });
    const initial = (await bindings.get(opened.id))!;
    await bindings.set(opened.id, connector.id, initial.revision);
    let finish!: () => void;
    const response = new Promise<void>((resolve) => {
      finish = resolve;
    });
    try {
      const admitted = await bindings.withAuthority(opened.id, (state) => {
        expect(state?.binding.connectorId).toBe(connector.id);
        return { value: response };
      });
      expect(admitted.value).toBe(response);
      await scope.exclusive(() => scope.reset(connector.id));
      await harness.capabilities.cases.close(opened.id, 'Settled.');
      expect(await bindings.authoritySnapshot(opened.id)).toBeUndefined();
    } finally {
      finish();
    }
  });

  it('preserves authority across passive fences but replaces it after an owner revokes and reselects', async () => {
    harness = await startHarness();
    const book = new ConnectorBook({
      store: createFileConnectorStore(join(harness.stateDir, 'connectors')),
    });
    const connector = await book.create({
      title: 'Notes',
      kind: 'notes',
      protocol: 'mcp',
      endpoint: 'https://notes.example/mcp',
      auth: 'none',
    });
    const { case: opened } = await harness.capabilities.cases.open(SIGN_IN);
    const scope = createCaseActionScope(join(harness.stateDir, 'case-action-scope'));
    const options = {
      directory: join(harness.stateDir, 'case-connector-bindings'),
      cases: harness.capabilities.cases,
      connectors: book,
      scope,
      writes: createCaseActionScope(join(harness.stateDir, 'cases')),
    };
    const bindings = createCaseConnectorBindings(options);
    const authority = () => bindings.authoritySnapshot(opened.id);
    const initial = (await bindings.get(opened.id))!;
    expect(await authority()).toBeUndefined();
    const selected = (await bindings.set(opened.id, connector.id, initial.revision))!;
    expect(selected).not.toHaveProperty('generation');
    const first = (await authority())!;
    expect(first.connectorId).toBe(connector.id);
    const fenced = (await bindings.fence(opened.id, selected.revision))!;
    expect(fenced.revision).not.toBe(selected.revision);
    expect(await authority()).toEqual(first);
    const removed = (await bindings.set(opened.id, null, fenced.revision))!;
    expect(await authority()).toBeUndefined();
    await bindings.set(opened.id, connector.id, removed.revision);
    const reselected = (await authority())!;
    expect(reselected.generation).not.toBe(first.generation);
    const restarted = createCaseConnectorBindings(options);
    expect(await restarted.authoritySnapshot(opened.id)).toEqual(reselected);
    await harness.capabilities.cases.close(opened.id, 'Settled.');
    expect(await authority()).toBeUndefined();
  });

  it('accepts legacy settings conservatively and fails closed for damaged generations or recovery', async () => {
    harness = await startHarness();
    const book = new ConnectorBook({
      store: createFileConnectorStore(join(harness.stateDir, 'connectors')),
    });
    const connector = await book.create({
      title: 'Notes',
      kind: 'notes',
      protocol: 'mcp',
      endpoint: 'https://notes.example/mcp',
      auth: 'none',
    });
    const { case: opened } = await harness.capabilities.cases.open(SIGN_IN);
    const scope = createCaseActionScope(join(harness.stateDir, 'case-action-scope'));
    const directory = join(harness.stateDir, 'case-connector-bindings');
    const bindings = createCaseConnectorBindings({
      directory,
      cases: harness.capabilities.cases,
      connectors: book,
      scope,
      writes: createCaseActionScope(join(harness.stateDir, 'cases')),
    });
    const path = join(directory, `${opened.id}.json`);
    const revision = '00000000-0000-4000-8000-000000000001';
    writeFileSync(path, JSON.stringify({ revision, connectorId: connector.id }));
    const authority = () => bindings.authoritySnapshot(opened.id);
    expect(await authority()).toEqual({ connectorId: connector.id, generation: revision });
    await bindings.fence(opened.id, revision);
    expect(await authority()).toEqual({ connectorId: connector.id, generation: revision });
    writeFileSync(`${path}.recovery`, revision);
    expect(await authority()).toBeUndefined();
    await bindings.get(opened.id);
    expect((await authority())?.generation).not.toBe(revision);
    writeFileSync(
      path,
      JSON.stringify({ revision, generation: 'damaged', connectorId: connector.id }),
    );
    await expect(authority()).rejects.toThrow(/cannot be read/u);
    expect((await bindings.get(opened.id))?.error).toBe(true);
  });

  it('orders authority snapshots and case closure across agent instances', async () => {
    harness = await startHarness();
    const other = await startHarness({ stateDir: harness.stateDir });
    const book = new ConnectorBook({
      store: createFileConnectorStore(join(harness.stateDir, 'connectors')),
    });
    const connector = await book.create({
      title: 'Notes',
      kind: 'notes',
      protocol: 'mcp',
      endpoint: 'https://notes.example/mcp',
      auth: 'none',
    });
    const { case: opened } = await harness.capabilities.cases.open(SIGN_IN);
    const bindings = createCaseConnectorBindings({
      directory: join(harness.stateDir, 'case-connector-bindings'),
      cases: harness.capabilities.cases,
      connectors: book,
      scope: createCaseActionScope(join(harness.stateDir, 'case-action-scope')),
      writes: createCaseActionScope(join(harness.stateDir, 'cases')),
    });
    const initial = (await bindings.get(opened.id))!;
    await bindings.set(opened.id, connector.id, initial.revision);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const get = book.get.bind(book);
    const spy = vi.spyOn(book, 'get').mockImplementation(async (id) => {
      entered();
      await gate;
      return get(id);
    });
    const using = bindings.authoritySnapshot(opened.id);
    let closing: Promise<ICase> | undefined;
    try {
      await waiting;
      closing = other.capabilities.cases.close(opened.id, 'Settled.');
      const closedEarly = await Promise.race([
        closing.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);
      expect(closedEarly).toBe(false);
      expect((await other.capabilities.cases.get(opened.id))?.state).toBe('open');
      release();
      expect((await using)?.connectorId).toBe(connector.id);
      await closing;
      expect(await bindings.authoritySnapshot(opened.id)).toBeUndefined();
    } finally {
      release();
      await Promise.allSettled([using, ...(closing === undefined ? [] : [closing])]);
      spy.mockRestore();
      await other.close();
    }
  });

  it('lets another connector be blocked while an authority check waits for case writes', async () => {
    harness = await startHarness();
    const book = new ConnectorBook({
      store: createFileConnectorStore(join(harness.stateDir, 'connectors')),
    });
    const connector = await book.create({
      title: 'Notes',
      kind: 'notes',
      protocol: 'mcp',
      endpoint: 'https://notes.example/mcp',
      auth: 'none',
    });
    const another = await book.create({
      title: 'Other',
      kind: 'notes',
      protocol: 'mcp',
      endpoint: 'https://other.example/mcp',
      auth: 'none',
    });
    const { case: opened } = await harness.capabilities.cases.open(SIGN_IN);
    const scope = createCaseActionScope(join(harness.stateDir, 'case-action-scope'));
    const writes = createCaseActionScope(join(harness.stateDir, 'cases'));
    const bindings = createCaseConnectorBindings({
      directory: join(harness.stateDir, 'case-connector-bindings'),
      cases: harness.capabilities.cases,
      connectors: book,
      scope,
      writes,
    });
    const initial = (await bindings.get(opened.id))!;
    await bindings.set(opened.id, connector.id, initial.revision);
    await scope.exclusive(() => scope.initialize(another.id));
    let release!: () => void;
    let held!: () => void;
    let attempted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const tried = new Promise<void>((resolve) => {
      attempted = resolve;
    });
    const original = writes.tryExclusive.bind(writes);
    const spy = vi.spyOn(writes, 'tryExclusive').mockImplementation(async (work) => {
      const result = await original(work);
      attempted();
      return result;
    });
    const locked = writes.exclusive(async () => {
      held();
      await gate;
    });
    let checking: Promise<unknown> | undefined;
    try {
      await holding;
      checking = bindings.authoritySnapshot(opened.id);
      await tried;
      const blocked = scope.exclusive(() => scope.set(another.id, 'create_note', false));
      const prompt = await Promise.race([
        blocked.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 750)),
      ]);
      expect(prompt).toBe(true);
      release();
      await blocked;
      expect(((await checking) as { connectorId: string }).connectorId).toBe(connector.id);
    } finally {
      release();
      await Promise.allSettled([locked, ...(checking === undefined ? [] : [checking])]);
      spy.mockRestore();
    }
  });
});

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

describe('the person chooses a case connector', () => {
  it('gives separate instances distinct identities even with the same clock', async () => {
    const now = () => new Date('2026-01-01T00:00:00.000Z');
    const cases = createMemoryCaseStore();
    const goals = new GoalBook({ store: createMemoryGoalStore() });
    const first = new CaseBook({ store: cases, feed: goals, now });
    const second = new CaseBook({ store: cases, feed: goals, now });
    const a = await first.open({ ...SIGN_IN, source: 'item-a' });
    const b = await second.open({ ...SIGN_IN, source: 'item-b' });
    expect(a.case.id).not.toBe(b.case.id);
    const store = createMemoryConnectorStore();
    const one = new ConnectorBook({ store, now });
    const two = new ConnectorBook({ store, now });
    const connectorA = await one.create({
      title: 'Notes',
      kind: 'notes',
      protocol: 'mcp',
      endpoint: 'https://old.example/mcp',
    });
    const connectorB = await two.create({
      title: 'Notes',
      kind: 'notes',
      protocol: 'mcp',
      endpoint: 'https://new.example/mcp',
    });
    expect(connectorA.id).not.toBe(connectorB.id);
    expect(await store.get(connectorA.id)).toEqual(connectorA);
  });

  it('keeps model-supplied origins untrusted and serializes explicit owner choices', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    const first = await api.send('POST', 'connectors', {
      title: 'Work notes',
      kind: 'notes',
      endpoint: 'https://notes.example/mcp',
      auth: 'token',
    });
    const second = await api.send('POST', 'connectors', {
      title: 'Personal notes',
      kind: 'notes',
      endpoint: 'https://other.example/mcp',
      auth: 'token',
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const { case: opened } = await harness.capabilities.cases.open({
      ...SIGN_IN,
      connectorId: first.body.connector.id,
    });
    const path = `cases/${opened.id}/connector`;
    const initial = (await api.get(path)).body.binding;
    expect(initial.connectorId).toBeUndefined();
    const wanted = { connectorId: first.body.connector.id, revision: initial.revision };
    expect((await api.send('POST', path, wanted, { cookie: false })).status).toBe(403);
    expect((await api.send('POST', path, wanted, { write: false })).status).toBe(403);
    const [a, b] = await Promise.all([
      api.send('POST', path, wanted),
      api.send('POST', path, { connectorId: second.body.connector.id, revision: initial.revision }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const stored = (await api.get(path)).body.binding;
    expect([first.body.connector.id, second.body.connector.id]).toContain(stored.connectorId);
    expect(
      (await api.send('POST', path, { fence: true, revision: initial.revision })).body.binding,
    ).toEqual(stored);
    expect(
      (await api.send('POST', path, { connectorId: null, revision: initial.revision })).status,
    ).toBe(400);
    const removed = await api.send('POST', path, { connectorId: null, revision: stored.revision });
    expect(removed.status).toBe(200);
    expect(removed.body.binding.connectorId).toBeUndefined();
    expect((await api.send('POST', path, wanted)).status).toBe(400);
    expect(
      (
        await api.send('POST', path, {
          connectorId: 'connector-missing',
          revision: removed.body.binding.revision,
        })
      ).status,
    ).toBe(400);
    const file = join(harness.stateDir, 'case-connector-bindings', `${opened.id}.json`);
    expect(statSync(file).mode & 0o077).toBe(0);
    expect(readFileSync(file, 'utf8')).not.toContain(SIGN_IN.noticed);
    expect(harness.capabilities.tools.map((tool) => tool.getName())).not.toContain('CaseConnector');
  });

  it('fails closed on damaged settings and makes an old recovery token unusable after repair', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    const { case: opened } = await harness.capabilities.cases.open(SIGN_IN);
    const path = `cases/${opened.id}/connector`;
    await api.get(path);
    const file = join(harness.stateDir, 'case-connector-bindings', `${opened.id}.json`);
    writeFileSync(file, '{bad');
    const broken = (await api.get(path)).body.binding;
    expect(broken.error).toBe(true);
    expect(broken.connectorId).toBeUndefined();
    expect(
      (await api.send('POST', path, { connectorId: 'connector-mail-1', revision: broken.revision }))
        .status,
    ).toBe(400);
    const reset = await api.send('POST', path, { connectorId: null, revision: broken.revision });
    expect(reset.status).toBe(200);
    writeFileSync(file, '{bad');
    const brokenAgain = (await api.get(path)).body.binding;
    expect(brokenAgain.revision).not.toBe(broken.revision);
    expect(
      (await api.send('POST', path, { connectorId: null, revision: broken.revision })).status,
    ).toBe(400);
    expect(
      (await api.send('POST', path, { fence: true, revision: broken.revision })).body.binding,
    ).toEqual(brokenAgain);
  });

  it('recovers unexpected setting directories without deleting their contents', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    const { case: opened } = await harness.capabilities.cases.open(SIGN_IN);
    const path = `cases/${opened.id}/connector`;
    await api.get(path);
    const file = join(harness.stateDir, 'case-connector-bindings', `${opened.id}.json`);
    rmSync(file);
    mkdirSync(file);
    writeFileSync(join(file, 'keep'), 'owner data');
    mkdirSync(`${file}.recovery`);
    writeFileSync(join(`${file}.recovery`, 'keep'), 'recovery data');
    const broken = (await api.get(path)).body.binding;
    expect(broken.error).toBe(true);
    const reset = await api.send('POST', path, { connectorId: null, revision: broken.revision });
    expect(reset.status).toBe(200);
    expect(reset.body.binding.connectorId).toBeUndefined();
    const files = readdirSync(join(harness.stateDir, 'case-connector-bindings'));
    const saved = files.find((name) => name.startsWith(`${opened.id}.json.damaged-`));
    const savedRecovery = files.find((name) =>
      name.startsWith(`${opened.id}.json.recovery.damaged-`),
    );
    expect(
      readFileSync(join(harness.stateDir, 'case-connector-bindings', saved!, 'keep'), 'utf8'),
    ).toBe('owner data');
    expect(
      readFileSync(
        join(harness.stateDir, 'case-connector-bindings', savedRecovery!, 'keep'),
        'utf8',
      ),
    ).toBe('recovery data');
  });

  it('rejects a selection when the case closes before its write', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    const connector = await api.send('POST', 'connectors', {
      title: 'Notes',
      kind: 'notes',
      endpoint: 'https://notes.example/mcp',
      auth: 'token',
    });
    const { case: opened } = await harness.capabilities.cases.open(SIGN_IN);
    const path = `cases/${opened.id}/connector`;
    const initial = (await api.get(path)).body.binding;
    const book = harness.capabilities.cases;
    const original = book.get.bind(book);
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let paused = false;
    const spy = vi.spyOn(book, 'get').mockImplementation(async (id) => {
      const found = await original(id);
      if (!paused && id === opened.id) {
        paused = true;
        reached();
        await gate;
      }
      return found;
    });
    const selecting = api.send('POST', path, {
      connectorId: connector.body.connector.id,
      revision: initial.revision,
    });
    try {
      await seen;
      const store = createFileCaseStore(join(harness.stateDir, 'cases'));
      await store.put({ ...opened, state: 'closed' });
      release();
      expect((await selecting).status).toBe(400);
      expect((await api.get(path)).body.binding.connectorId).toBeUndefined();
    } finally {
      release();
      await Promise.allSettled([selecting]);
      spy.mockRestore();
    }
  });

  it('removes references before deleting a connector and ignores malformed orphan directories', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    const connector = await api.send('POST', 'connectors', {
      title: 'Notes',
      kind: 'notes',
      endpoint: 'https://notes.example/mcp',
      auth: 'token',
    });
    const { case: opened } = await harness.capabilities.cases.open(SIGN_IN);
    const path = `cases/${opened.id}/connector`;
    const initial = (await api.get(path)).body.binding;
    expect(
      (
        await api.send('POST', path, {
          connectorId: connector.body.connector.id,
          revision: initial.revision,
        })
      ).status,
    ).toBe(200);
    const orphan = join(harness.stateDir, 'case-connector-bindings', 'case-ghost.json');
    mkdirSync(orphan);
    writeFileSync(join(orphan, 'keep'), 'owner data');
    expect((await api.get(path)).status).toBe(200);
    expect(existsSync(orphan)).toBe(false);
    const saved = readdirSync(join(harness.stateDir, 'case-connector-bindings')).find((name) =>
      name.startsWith('case-ghost.json.damaged-'),
    );
    expect(
      readFileSync(join(harness.stateDir, 'case-connector-bindings', saved!, 'keep'), 'utf8'),
    ).toBe('owner data');
    expect(
      (await api.send('POST', `connectors/${connector.body.connector.id}/remove`, {})).status,
    ).toBe(200);
    expect((await api.get(path)).body.binding.connectorId).toBeUndefined();
  });

  it('still closes and keeps ordinary notes when the settings lock is unavailable', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    const connector = await api.send('POST', 'connectors', {
      title: 'Notes',
      kind: 'notes',
      endpoint: 'https://notes.example/mcp',
      auth: 'token',
    });
    const { case: opened } = await harness.capabilities.cases.open(SIGN_IN);
    const path = `cases/${opened.id}/connector`;
    const initial = (await api.get(path)).body.binding;
    await api.send('POST', path, {
      connectorId: connector.body.connector.id,
      revision: initial.revision,
    });
    const scope = createCaseActionScope(join(harness.stateDir, 'case-action-scope'));
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const holding = scope.exclusive(async () => {
      entered();
      await gate;
    });
    try {
      await held;
      await harness.capabilities.cases.note(opened.id, 'A normal note.');
      await harness.capabilities.cases.close(opened.id, 'Settled.');
    } finally {
      release();
      await holding;
    }
    expect((await api.get(path)).body.binding.connectorId).toBeUndefined();
  }, 15_000);

  it('orders a delayed note before closure and refuses notes after closure', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    const connector = await api.send('POST', 'connectors', {
      title: 'Notes',
      kind: 'notes',
      endpoint: 'https://notes.example/mcp',
      auth: 'token',
    });
    const { case: opened } = await harness.capabilities.cases.open(SIGN_IN);
    const path = `cases/${opened.id}/connector`;
    const initial = (await api.get(path)).body.binding;
    await api.send('POST', path, {
      connectorId: connector.body.connector.id,
      revision: initial.revision,
    });
    const other = await startHarness({ stateDir: harness.stateDir });
    const book = other.capabilities.cases as unknown as {
      store: { get: (id: string) => Promise<ICase | undefined> };
    };
    const original = book.store.get.bind(book.store);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const spy = vi.spyOn(book.store, 'get').mockImplementation(async (id) => {
      const result = await original(id);
      entered();
      await gate;
      return result;
    });
    const bindingDir = join(harness.stateDir, 'case-connector-bindings');
    let closing: Promise<ICase> | undefined;
    try {
      const note = other.capabilities.cases.note(opened.id, 'A delayed note.');
      await paused;
      chmodSync(bindingDir, 0o000);
      closing = harness.capabilities.cases.close(opened.id, 'Settled.');
      const early = await Promise.race([
        closing.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);
      expect(early).toBe(false);
      release();
      await note;
      await closing;
      chmodSync(bindingDir, 0o700);
      spy.mockRestore();
      await expect(other.capabilities.cases.note(opened.id, 'Too late.')).rejects.toThrow(
        /closed/u,
      );
      expect((await api.get(path)).body.binding.connectorId).toBeUndefined();
      expect((await harness.capabilities.cases.get(opened.id))?.state).toBe('closed');
    } finally {
      chmodSync(bindingDir, 0o700);
      release();
      if (closing !== undefined) await closing.catch(() => undefined);
      spy.mockRestore();
      await other.close();
    }
  }, 15_000);

  it('does not hold unrelated case writes while connector settings are busy', async () => {
    harness = await startHarness();
    const first = await harness.capabilities.cases.open(SIGN_IN);
    const second = await harness.capabilities.cases.open({ ...SIGN_IN, source: 'another-item' });
    const other = await startHarness({ stateDir: harness.stateDir });
    const scope = createCaseActionScope(join(harness.stateDir, 'case-action-scope'));
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const holding = scope.exclusive(async () => {
      entered();
      await gate;
    });
    let closing: Promise<ICase> | undefined;
    try {
      await held;
      closing = harness.capabilities.cases.close(first.case.id, 'Settled.');
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      const note = other.capabilities.cases.note(second.case.id, 'Still available.');
      const completed = await Promise.race([
        note.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 750)),
      ]);
      expect(completed).toBe(true);
      await note;
    } finally {
      release();
      await holding;
      await closing;
      await other.close();
    }
  }, 15_000);

  it('does not hold connector settings while a case write is busy', async () => {
    harness = await startHarness();
    const opened = await harness.capabilities.cases.open(SIGN_IN);
    const writes = createCaseActionScope(join(harness.stateDir, 'cases'));
    const scope = createCaseActionScope(join(harness.stateDir, 'case-action-scope'));
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const holding = writes.exclusive(async () => {
      entered();
      await gate;
    });
    let closing: Promise<ICase> | undefined;
    try {
      await held;
      closing = harness.capabilities.cases.close(opened.case.id, 'Settled.');
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      const setting = scope.exclusive(async () => true);
      const completed = await Promise.race([
        setting,
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 750)),
      ]);
      expect(completed).toBe(true);
      await setting;
    } finally {
      release();
      await holding;
      await closing;
    }
  }, 15_000);
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
  function apiWith(
    onCaseAnswered: (answered: ICase, snapshot?: ICaseActionSnapshot) => void,
    captureCaseAction?: IPersonalApiOptions['captureCaseAction'],
  ) {
    const goals = new GoalBook({ store: createMemoryGoalStore() });
    const cases = new CaseBook({ store: createMemoryCaseStore(), feed: goals });
    const api = createPersonalApi({
      goals,
      cases,
      onCaseAnswered,
      captureCaseAction,
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

  it('captures authority before accepting the answer and passes it only for that answer', async () => {
    const seen: (ICaseActionSnapshot | undefined)[] = [];
    let capturedWhileWaiting = false;
    const { cases, answer } = apiWith(
      (_answered, snapshot) => seen.push(snapshot),
      async (caseId, feedItemId) => {
        capturedWhileWaiting = (await cases.get(caseId))?.question?.feedItemId === feedItemId;
        return {
          caseId,
          feedItemId,
          connectorId: 'connector-mail',
          bindingGeneration: 'binding',
          scopeGeneration: 'scope',
          tools: ['send'],
        };
      },
    );
    const { case: opened } = await cases.open(SIGN_IN);
    const { item } = await cases.ask(opened.id, { question: 'Sure?', options: ['Yes'] });
    expect((await answer(item.id, { choice: 'Yes' })).status).toBe(200);
    expect(capturedWhileWaiting).toBe(true);
    expect(seen).toEqual([expect.objectContaining({ caseId: opened.id, feedItemId: item.id })]);
  });

  it('records the answer without authority if its capture is unavailable or too slow', async () => {
    const seen: (ICaseActionSnapshot | undefined)[] = [];
    let finish!: (snapshot: ICaseActionSnapshot) => void;
    const late = new Promise<ICaseActionSnapshot>((resolve) => {
      finish = resolve;
    });
    const { cases, answer } = apiWith(
      (_answered, snapshot) => seen.push(snapshot),
      async () => late,
    );
    const { case: opened } = await cases.open(SIGN_IN);
    const { item } = await cases.ask(opened.id, { question: 'Sure?', options: ['Yes'] });
    expect((await answer(item.id, { choice: 'Yes' })).status).toBe(200);
    expect(seen).toEqual([undefined]);
    finish({
      caseId: opened.id,
      feedItemId: item.id,
      connectorId: 'connector-mail',
      bindingGeneration: 'later',
      scopeGeneration: 'later',
      tools: ['send'],
    });
    await Promise.resolve();
    expect(seen).toEqual([undefined]);
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
    const before = (method: string, segments: string[], body?: unknown) =>
      first.capabilities.api({
        method,
        path: `/${segments.join('/')}`,
        segments,
        query: new URLSearchParams(),
        body,
      });
    const connector = await before('POST', ['connectors'], {
      title: 'Notes',
      kind: 'notes',
      endpoint: 'https://notes.example/mcp',
      auth: 'token',
    });
    const binding = (await before('GET', ['cases', opened.id, 'connector'])).body as any;
    const selected = await before('POST', ['cases', opened.id, 'connector'], {
      connectorId: (connector.body as any).connector.id,
      revision: binding.binding.revision,
    });
    expect(selected.status).toBe(200);
    await first.close();

    harness = await startHarness({ stateDir, gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    const read = (await api.get(`cases/${opened.id}`)).body.case as ICase;
    expect((await api.get(`cases/${opened.id}/connector`)).body.binding).toEqual(
      (selected.body as any).binding,
    );
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
