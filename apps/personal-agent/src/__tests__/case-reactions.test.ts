/**
 * How the questions of cases are answered, recorded by the kind of service each came from: counts and
 * times only, settled from the feed card, and read by nothing that sets a limit.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CaseBook,
  ConnectorBook,
  GoalBook,
  createMemoryCaseStore,
  createMemoryConnectorStore,
  createMemoryGoalStore,
} from '@robota-sdk/agent-product/personal';

import { OPEN_WINDOW_MS, REACTION_LIMIT, createCaseReactions } from '../case-reactions.js';
import { createFixtureWebRoot, startHarness } from './harness.js';

import type { TConnectorKind } from '@robota-sdk/agent-product/personal';
import type { IHarness } from './harness.js';

const directories: string[] = [];
let harness: IHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const START = Date.parse('2026-11-16T10:00:00.000Z');
const clock = { at: START };
const now = (): Date => new Date(clock.at);

const QUESTION = 'Was the secret door code 4417 really yours?';
const NOTICED = 'A mail from Example Bank mentions invoice 90210 for the blue apartment.';
const REPLY = 'Yes, my passphrase is lantern-orchid';

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'case-reactions-'));
  directories.push(path);
  return path;
}

async function setup(root = directory()) {
  clock.at = START;
  const goals = new GoalBook({ store: createMemoryGoalStore(), now });
  const connectors = new ConnectorBook({ store: createMemoryConnectorStore(), now });
  const make = () =>
    createCaseReactions({
      directory: root,
      kindOf: async (id) => (await connectors.get(id))?.kind,
      card: (id) => goals.feedItem(id),
      now,
    });
  const reactions = make();
  const pending: Promise<unknown>[] = [];
  const cases = new CaseBook({
    store: createMemoryCaseStore(),
    feed: goals,
    now,
    onAsked: (event) => {
      pending.push(reactions.asked(event));
    },
  });
  const connect = async (kind: TConnectorKind) =>
    (
      await connectors.create({
        title: `A ${kind} service`,
        kind,
        protocol: 'mcp',
        endpoint: `https://${kind}.example/mcp`,
        auth: 'none',
      })
    ).id;
  let counter = 0;
  const ask = async (connectorId?: string, options: readonly string[] = ['Yes', 'No']) => {
    counter += 1;
    const { case: opened } = await cases.open({
      title: 'Something to check',
      noticed: NOTICED,
      source: `source:${counter}`,
      ...(connectorId !== undefined && { connectorId }),
    });
    const { item } = await cases.ask(opened.id, {
      question: QUESTION,
      options: [...options],
      allowsReply: true,
    });
    await Promise.all(pending.splice(0));
    return { opened, item };
  };
  return { goals, cases, connect, ask, reactions, make, root };
}

describe('how case questions are answered, by kind of service', () => {
  it('records an asked question with the kind of its service', async () => {
    const { connect, ask, reactions } = await setup();
    const mail = await connect('mail');
    await ask(mail);
    await ask(mail);
    await ask(await connect('calendar'));
    await ask();
    await ask('connector-gone');
    const summary = await reactions.summary();
    expect(summary.mail?.asked).toBe(2);
    expect(summary.calendar?.asked).toBe(1);
    expect(summary.none?.asked).toBe(2);
    expect(summary.mail).toEqual({
      asked: 2,
      answered: 0,
      unanswered: 0,
      open: 2,
      dismissed: 0,
      medianSecondsToAnswer: null,
    });
  });

  it('records an answer and the time it took, from its card', async () => {
    const { connect, ask, cases, reactions } = await setup();
    const mail = await connect('mail');
    const first = await ask(mail);
    const second = await ask(mail);
    clock.at = START + 90_000;
    await cases.answer(first.item.id, { choice: 'Yes' });
    clock.at = START + 400_000;
    await cases.answer(second.item.id, { reply: REPLY });
    const mailSummary = (await reactions.summary()).mail!;
    expect(mailSummary.answered).toBe(2);
    expect(mailSummary.open).toBe(0);
    expect(mailSummary.medianSecondsToAnswer).toBe((90 + 400) / 2);
  });

  it('counts a withdrawn question, or one open past the window, as unanswered', async () => {
    const { connect, ask, cases, reactions } = await setup();
    const mail = await connect('mail');
    const withdrawn = await ask(mail);
    await ask(mail);
    await cases.close(withdrawn.opened.id, 'No longer needed');
    expect((await reactions.summary()).mail).toMatchObject({ asked: 2, unanswered: 1, open: 1 });
    clock.at = START + OPEN_WINDOW_MS - 1000;
    expect((await reactions.summary()).mail).toMatchObject({ unanswered: 1, open: 1 });
    clock.at = START + OPEN_WINDOW_MS + 1000;
    expect((await reactions.summary()).mail).toMatchObject({
      asked: 2,
      answered: 0,
      unanswered: 2,
      open: 0,
    });
  });

  it('keeps a dismissal apart from answers', async () => {
    const { connect, ask, cases, goals, reactions } = await setup();
    const mail = await connect('mail');
    const answered = await ask(mail);
    const withdrawn = await ask(mail);
    await ask(mail);
    await cases.answer(answered.item.id, { choice: 'No' });
    await cases.close(withdrawn.opened.id, 'Settled elsewhere');
    await goals.dismiss(answered.item.id);
    await goals.dismiss(withdrawn.item.id);
    expect((await reactions.summary()).mail).toMatchObject({
      asked: 3,
      answered: 1,
      unanswered: 1,
      open: 1,
      dismissed: 2,
    });
  });

  it('survives a restart and stays within its bound', async () => {
    const root = directory();
    const { connect, ask, cases, make, reactions } = await setup(root);
    const mail = await connect('mail');
    const answered = await ask(mail);
    clock.at = START + 5000;
    await cases.answer(answered.item.id, { choice: 'Yes' });
    await reactions.reconcile();
    const restarted = make();
    expect((await restarted.summary()).mail).toMatchObject({
      asked: 1,
      answered: 1,
      medianSecondsToAnswer: 5,
    });
    const stored = join(root, 'case-reactions.json');
    expect(statSync(stored).mode & 0o777).toBe(0o600);

    const entries = Array.from({ length: REACTION_LIMIT + 20 }, (_, index) => ({
      feedItemId: `feed-bulk-${index}`,
      caseId: `case-bulk${index}`,
      kind: 'files',
      askedAt: new Date(START + index).toISOString(),
      ...(index < 30 && { withdrawnAt: new Date(START + index).toISOString() }),
    }));
    writeFileSync(stored, JSON.stringify({ reactions: entries }));
    await ask(mail);
    const kept = JSON.parse(readFileSync(stored, 'utf8')).reactions as { feedItemId: string }[];
    expect(kept).toHaveLength(REACTION_LIMIT);
    // The oldest settled records went first, so the unsettled ones and the newest stay.
    expect(kept.some((entry) => entry.feedItemId === 'feed-bulk-0')).toBe(false);
    expect(kept.some((entry) => entry.feedItemId === 'feed-bulk-519')).toBe(true);
    expect(kept.some((entry) => entry.feedItemId === 'feed-bulk-30')).toBe(true);
  });

  it('holds no question, answer or source text', async () => {
    const root = directory();
    const { connect, ask, cases, reactions } = await setup(root);
    const mail = await connect('mail');
    const { item } = await ask(mail);
    const secrets = [QUESTION, NOTICED, REPLY, 'Example Bank', 'lantern', '4417', 'source:'];
    const stored = () => readFileSync(join(root, 'case-reactions.json'), 'utf8');
    expect(stored()).toContain('feed-');
    for (const text of secrets) expect(stored()).not.toContain(text);
    await cases.answer(item.id, { reply: REPLY });
    await reactions.reconcile();
    expect(stored()).toContain('answeredAt');
    for (const text of secrets) expect(stored()).not.toContain(text);
  });
});

describe('the personal agent records and reports reactions', () => {
  it('changes no delivery setting or count, and its route answers the summary', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const gui = harness.local.gui!;
    const login = await fetch(new URL('/__monitor_login', gui.url), {
      method: 'POST',
      body: new URLSearchParams({ code: gui.accessCode }),
      redirect: 'manual',
    });
    const base = new URL(`${login.headers.get('location')!}api/`, gui.url);
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const get = async (path: string) => {
      const response = await fetch(new URL(path, base), { headers: { cookie } });
      return { status: response.status, body: (await response.json()) as any };
    };

    const before = (await get('delivery')).body;
    const { cases } = harness.capabilities;
    const { case: opened } = await cases.open({
      title: 'Something to check',
      noticed: NOTICED,
      source: 'source:route',
    });
    const { item } = await cases.ask(opened.id, { question: QUESTION, options: ['Yes', 'No'] });
    const reaction = JSON.stringify((await get('cases/reactions')).body);
    expect(reaction).not.toContain(QUESTION);
    expect((await get('cases/reactions')).body.reactions.none).toMatchObject({
      asked: 1,
      open: 1,
    });
    expect((await get(`cases/${opened.id}`)).status).toBe(200);
    expect(existsSync(join(harness.stateDir, 'case-reactions', 'case-reactions.json'))).toBe(true);

    await cases.answer(item.id, { choice: 'Yes' });
    expect((await get('cases/reactions')).body.reactions.none).toMatchObject({
      answered: 1,
      open: 0,
    });
    const after = (await get('delivery')).body;
    expect(after.settings).toEqual(before.settings);
    expect(after.today).toEqual(before.today);
  });
});
