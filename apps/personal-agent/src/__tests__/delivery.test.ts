/**
 * Which of the agent's questions reach the person beyond the feed: the agent suggests an urgency, the
 * person's own limits decide. The first group runs the whole agent against a scripted model with a
 * fixture channel standing in for a messenger and a clock the test moves; the second group is the
 * person's own routes to the limits; the third is what the agent can and cannot reach.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CASE_INSTRUCTIONS,
  caseTurnInstructions,
  caseTurnTools,
  createFixtureChannel,
  syncRunInstructions,
  syncRunTools,
} from '@robota-sdk/agent-product/personal';

import { offeredTools, toolResults } from './scripted-model.js';
import { createFixtureWebRoot, startHarness } from './harness.js';
import { startStandInConnector, virtualHostFetch } from './stand-in-connector.js';

import type { IConnector, IFixtureChannel } from '@robota-sdk/agent-product/personal';
import type { IHarness } from './harness.js';
import type { IModelRequest, TModelReply } from './scripted-model.js';
import type { TRunSession } from '../goal-runner.js';

/** A local time on the sixteenth of November, or on `day`: delivery reads the machine's own clock. */
const at = (hours: number, minutes = 0, day = 16): Date => new Date(2026, 10, day, hours, minutes);

const POINTER = 'Open your Feed to answer.';
const MAIL_HOST = 'mail.stand-in.test';
const DEFAULTS = {
  dailyLimit: 3,
  quietHours: { enabled: true, from: '22:00', to: '08:00' },
  digest: { enabled: true, at: '08:00' },
};
const clock = { now: at(10) };

let harness: IHarness | undefined;
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await harness?.close();
  harness = undefined;
  for (const close of closers.splice(0)) await close();
  clock.now = at(10);
});

async function start(
  options: {
    channel?: boolean;
    gui?: boolean;
    connectorNetwork?: NonNullable<Parameters<typeof startHarness>[0]>['connectorNetwork'];
  } = {},
): Promise<{ started: IHarness; channel: IFixtureChannel }> {
  harness = await startHarness({
    deliveryClock: () => clock.now,
    ...(options.gui === true && { gui: true, webRoot: createFixtureWebRoot() }),
    ...(options.connectorNetwork !== undefined && { connectorNetwork: options.connectorNetwork }),
  });
  const channel = createFixtureChannel();
  if (options.channel !== false) await connect(harness, channel);
  return { started: harness, channel };
}

const connect = (started: IHarness, channel: IFixtureChannel): Promise<void> =>
  started.capabilities.channels.connect({
    adapter: channel,
    ownerSenderIds: ['owner-1'],
    notifyConversationId: 'dm',
  });

const caseIdIn = (request: IModelRequest): string =>
  /case-[a-z0-9]+/u.exec(toolResults(request).at(-1) ?? '')![0];

/** A chat turn in which the agent opens a case and asks its question with the given urgency. */
async function askInChat(
  started: IHarness,
  title: string,
  extra: Record<string, unknown>,
): Promise<void> {
  started.model.script(
    {
      tool: 'CaseOpen',
      args: { title, noticed: `A mail says: ${title}.`, source: `chat:${title}` },
    },
    (request) => ({
      tool: 'CaseAsk',
      args: { id: caseIdIn(request), question: 'Was this you?', options: ['Yes', 'No'], ...extra },
    }),
    { text: 'I asked you in your feed.' },
  );
  expect((await started.submit(`Keep a case on ${title}.`)).text).toContain('asked you');
  await started.capabilities.delivery.idle();
}

const status = (started: IHarness) => started.capabilities.delivery.status();

async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** The personal API, called the way the GUI server calls it once the person is let in. */
const call = (started: IHarness, method: string, segments: string[], body?: unknown) =>
  started.capabilities.api({
    method,
    path: `/${segments.join('/')}`,
    segments,
    query: new URLSearchParams(),
    body,
  });

/** Everything queued on the way to the channel has been sent: the fixture channel takes no real time. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A case whose first question is in the feed. The person answers it, the agent takes its turn on the
 * case with the replies given for the case id, and this resolves once the turn has ended and whatever
 * it queued has been sent.
 */
async function takeCaseTurn(
  started: IHarness,
  replies: (caseId: string) => TModelReply[],
): Promise<{ caseId: string; goalId: string }> {
  const { cases, goals } = started.capabilities;
  const { case: opened } = await cases.open({
    title: 'New sign-in from Lagos',
    noticed: 'A mail says a new sign-in happened.',
    source: 'mail:1',
  });
  const { item } = await cases.ask(opened.id, {
    question: 'Was this you?',
    options: ['Yes', 'No'],
  });
  started.model.script(...replies(opened.id));
  expect((await call(started, 'POST', ['feed', item.id, 'answer'], { choice: 'No' })).status).toBe(
    200,
  );
  const caseGoal = async () => (await goals.list()).find((goal) => goal.caseId === opened.id);
  await until(async () => {
    const goal = await caseGoal();
    return (
      goal !== undefined &&
      (goal.status === 'done' || goal.status === 'failed') &&
      (await goals.runs(goal.id)).length >= 1
    );
  }, 'the turn on the case');
  await started.capabilities.runner()!.settled();
  await started.capabilities.delivery.idle();
  await flush();
  return { caseId: opened.id, goalId: (await caseGoal())!.id };
}

describe('a question the agent marks as needing the person now', () => {
  it('reaches the channel as one message, and counts against the day’s limit', async () => {
    const { started, channel } = await start();
    await askInChat(started, 'New sign-in from Lagos', { urgency: 'now' });
    expect(channel.sent).toEqual([
      { conversationId: 'dm', text: `New sign-in from Lagos: Was this you?\n${POINTER}` },
    ]);
    expect(
      (await started.capabilities.goals.feed()).filter((item) => item.kind === 'question'),
    ).toHaveLength(1);
    expect(await status(started)).toEqual(
      expect.objectContaining({ today: { sent: 1, limit: 3 }, waitingInDigest: 0 }),
    );
  });

  it('reaches the channel from a case turn too, as the only message that run sends', async () => {
    const { started, channel } = await start();
    const { goals } = started.capabilities;
    await takeCaseTurn(started, (id) => [
      {
        tool: 'CaseAsk',
        args: {
          id,
          question: 'Have you signed out the other sessions?',
          options: ['Yes', 'Not yet'],
          urgency: 'now',
        },
      },
      { text: 'I asked about the other sessions.' },
    ]);
    // The turn left a question, so its report stays in the goal's history: the question is all there is.
    expect(channel.sent).toEqual([
      {
        conversationId: 'dm',
        text: `New sign-in from Lagos: Have you signed out the other sessions?\n${POINTER}`,
      },
    ]);
    expect((await goals.feed()).filter((entry) => entry.question?.state === 'open')).toHaveLength(
      1,
    );
    expect((await status(started)).today.sent).toBe(1);
  });

  it('is held for the digest once the limit is reached, and reaches the channel only through it', async () => {
    const { started, channel } = await start();
    expect((await call(started, 'PUT', ['delivery'], { dailyLimit: 1 })).status).toBe(200);
    await askInChat(started, 'Sign-in from Lagos', { urgency: 'now' });
    await askInChat(started, 'Bill due tomorrow', { urgency: 'now' });
    expect(channel.sent.map((message) => message.text.split('\n')[0])).toEqual([
      'Sign-in from Lagos: Was this you?',
    ]);
    expect(await status(started)).toEqual(
      expect.objectContaining({ today: { sent: 1, limit: 1 }, waitingInDigest: 1 }),
    );

    clock.now = at(7, 59, 17);
    await started.capabilities.delivery.tick();
    expect(channel.sent).toHaveLength(1);
    clock.now = at(8, 0, 17);
    await started.capabilities.delivery.tick();
    await started.capabilities.delivery.tick();
    expect(channel.sent).toHaveLength(2);
    expect(channel.sent[1]!.text).toBe(
      `1 question is waiting for you:\n- Bill due tomorrow\n${POINTER}`,
    );
    expect(await status(started)).toEqual(
      expect.objectContaining({ today: { sent: 0, limit: 1 }, waitingInDigest: 0 }),
    );
  });

  it('reaches nothing inside quiet hours, and goes out in the digest when they are over', async () => {
    const { started, channel } = await start();
    clock.now = at(23, 0);
    await askInChat(started, 'Sign-in from Lagos', { urgency: 'now' });
    expect(channel.sent).toEqual([]);
    expect(await status(started)).toEqual(
      expect.objectContaining({ today: { sent: 0, limit: 3 }, waitingInDigest: 1 }),
    );
    clock.now = at(8, 0, 17);
    await started.capabilities.delivery.tick();
    expect(channel.sent).toEqual([
      {
        conversationId: 'dm',
        text: `1 question is waiting for you:\n- Sign-in from Lagos\n${POINTER}`,
      },
    ]);
  });

  it('is not counted, and stays in the feed, when no channel is connected to take it', async () => {
    const { started, channel } = await start({ channel: false });
    await askInChat(started, 'Sign-in from Lagos', { urgency: 'now' });
    expect(await status(started)).toEqual(
      expect.objectContaining({ today: { sent: 0, limit: 3 } }),
    );
    expect(
      (await started.capabilities.goals.feed()).filter((item) => item.question?.state === 'open'),
    ).toHaveLength(1);
    // The limit is untouched: once a channel is there, the next one is pushed.
    await connect(started, channel);
    await askInChat(started, 'Bill due tomorrow', { urgency: 'now' });
    expect(channel.sent.map((message) => message.text.split('\n')[0])).toEqual([
      'Bill due tomorrow: Was this you?',
    ]);
  });
});

describe('a question the agent does not mark as needing the person now', () => {
  it('reaches no channel when it is for the feed, or says nothing, and none before the digest when it can wait', async () => {
    const { started, channel } = await start();
    await askInChat(started, 'A newsletter', { urgency: 'feed' });
    await askInChat(started, 'A receipt', {});
    await askInChat(started, 'A reminder', { urgency: 'digest' });
    expect(channel.sent).toEqual([]);
    expect(await status(started)).toEqual(
      expect.objectContaining({ today: { sent: 0, limit: 3 }, waitingInDigest: 1 }),
    );
    clock.now = at(8, 0, 17);
    await started.capabilities.delivery.tick();
    expect(channel.sent).toEqual([
      { conversationId: 'dm', text: `1 question is waiting for you:\n- A reminder\n${POINTER}` },
    ]);
  });

  it('is refused with a message the agent can act on when the urgency is not one of the three', async () => {
    const { started, channel } = await start();
    started.model.script(
      { tool: 'CaseOpen', args: { title: 'Odd', noticed: 'Something odd.', source: 'chat:odd' } },
      (request) => ({
        tool: 'CaseAsk',
        args: {
          id: caseIdIn(request),
          question: 'Was this you?',
          options: ['Yes'],
          urgency: 'asap',
        },
      }),
      { text: 'Done.' },
    );
    await started.submit('Keep a case.');
    await started.capabilities.delivery.idle();
    expect(toolResults(started.model.requests.at(-1)!).at(-1)).toContain(
      'The urgency must be one of now, digest, feed',
    );
    expect(channel.sent).toEqual([]);
    expect(
      (await started.capabilities.goals.feed()).filter((item) => item.kind === 'question'),
    ).toEqual([]);
  });
});

/** A connected mail service holding one sign-in notice, kept in sync every hour. */
async function syncWorld() {
  const mail = await startStandInConnector({
    access: 'open',
    tools: [
      {
        name: 'list_messages',
        description: 'List the newest messages',
        annotations: { readOnlyHint: true },
        run: () =>
          'id: msg-1\nfrom: Example Security <security@example.test>\nsubject: New sign-in to your account\nA new sign-in happened at 10:02 from Seoul.',
      },
    ],
    publicBase: `https://${MAIL_HOST}`,
  });
  closers.push(mail.close);
  const { started, channel } = await start({
    connectorNetwork: {
      fetch: virtualHostFetch({ [MAIL_HOST]: mail.port }),
      lookup: async () => ['203.0.113.10'],
    },
  });
  const made = await call(started, 'POST', ['connectors'], {
    title: 'Work mail',
    kind: 'mail',
    endpoint: `https://${MAIL_HOST}/mcp`,
    auth: 'none',
  });
  expect(made.status).toBe(200);
  const id = (made.body as { connector: { id: string } }).connector.id;
  expect(
    (await call(started, 'POST', ['connectors', id, 'sync'], { everyMinutes: 60 })).status,
  ).toBe(200);
  const { goals } = started.capabilities;
  return {
    started,
    channel,
    /** What a model does that read the mail, opened a case for it and asked with this urgency. */
    raising: (urgency: string) =>
      started.model.script((request): TModelReply => {
        const done = toolResults(request).length;
        if (done === 0)
          return { tool: 'ConnectorRead', args: { connector: id, tool: 'list_messages' } };
        if (done === 1)
          return {
            tool: 'CaseOpen',
            args: {
              title: 'New sign-in to your account',
              noticed: 'A mail says a new sign-in happened at 10:02 from Seoul.',
              source: 'mail:msg-1',
              connector: id,
            },
          };
        if (done === 2)
          return {
            tool: 'CaseAsk',
            args: {
              id: caseIdIn(request),
              question: 'Did you sign in just now?',
              options: ['Yes, it was me', 'No'],
              urgency,
            },
          };
        return { text: 'I opened 1 case.' };
      }),
    /** Run the sync goal once, as the runner does when it is due, and wait until it has ended. */
    async sync(): Promise<void> {
      const goal = (await goals.list()).find((candidate) => candidate.connectorId === id)!;
      await goals.resume(goal.id);
      const runner = started.capabilities.runner()!;
      await runner.runDue();
      await runner.settled();
      await started.capabilities.delivery.idle();
      await flush();
    },
  };
}

describe('the report of a run the agent started on its own', () => {
  it('is not pushed when the run is quiet, though the question it left in the feed is its own matter', async () => {
    const { started, channel } = await start();
    const { goalId } = await takeCaseTurn(started, (id) => [
      {
        tool: 'CaseAsk',
        args: {
          id,
          question: 'Have you signed out the other sessions?',
          options: ['Yes', 'Not yet'],
          urgency: 'feed',
        },
      },
      { text: 'I asked about the other sessions.' },
    ]);
    // The run happened and was recorded; none of it went to the channel.
    const [run] = await started.capabilities.goals.runs(goalId);
    expect(run).toEqual(
      expect.objectContaining({ outcome: 'done', report: 'I asked about the other sessions.' }),
    );
    expect(channel.sent).toEqual([]);
    expect(await status(started)).toEqual(
      expect.objectContaining({ today: { sent: 0, limit: 3 } }),
    );
  });

  it('is not pushed for a quiet sync run either, whatever the urgency of the question it raised', async () => {
    const quiet = await syncWorld();
    quiet.raising('feed');
    await quiet.sync();
    const goal = (await quiet.started.capabilities.goals.list())[0]!;
    expect((await quiet.started.capabilities.goals.runs(goal.id))[0]).toEqual(
      expect.objectContaining({ outcome: 'done', report: 'I opened 1 case.' }),
    );
    expect(quiet.channel.sent).toEqual([]);
  });

  it('leaves the question of a quiet sync run as the only message when the agent says it is needed now', async () => {
    const urgent = await syncWorld();
    urgent.raising('now');
    await urgent.sync();
    expect(urgent.channel.sent).toEqual([
      {
        conversationId: 'dm',
        text: `New sign-in to your account: Did you sign in just now?\n${POINTER}`,
      },
    ]);
  });

  it('is pushed when the run is not quiet: a turn that left nothing on the case, with the report as it was', async () => {
    const { started, channel } = await start();
    await takeCaseTurn(started, () => [{ text: 'Nothing more to do.' }]);
    expect(channel.sent).toEqual([
      { conversationId: 'dm', text: 'Case: New sign-in from Lagos: Nothing more to do.' },
    ]);
    // A report is the person's own goal output, not a question the agent chose to raise.
    expect(await status(started)).toEqual(
      expect.objectContaining({ today: { sent: 0, limit: 3 } }),
    );
  });

  it('is pushed when the run failed, which is never quiet', async () => {
    const { started, channel } = await start();
    const unreachable = {
      on: () => undefined,
      off: () => undefined,
      submit: async () => {
        throw new Error('The model could not be reached');
      },
      resolvePermission: () => undefined,
      abort: () => undefined,
      shutdown: async () => undefined,
    } as unknown as TRunSession;
    vi.spyOn(started.local.agent, 'openSession').mockImplementation(() => unreachable as never);
    await takeCaseTurn(started, () => [{ text: 'unused' }]);
    expect(channel.sent).toEqual([
      {
        conversationId: 'dm',
        text: 'Case: New sign-in from Lagos: The run failed: The model could not be reached',
      },
    ]);
  });

  it('is pushed when a sync run did not read the mail, so a broken sync is never silent', async () => {
    const { started, channel, sync } = await syncWorld();
    started.model.script({ text: 'I did not look.' });
    await sync();
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]!.text).toMatch(/: I did not look\.$/u);
  });
});

describe('the person’s own routes to the limits', () => {
  interface IClient {
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
    return {
      send: async (method, path, body, { cookie: withCookie = true, write = true } = {}) => {
        const response = await fetch(new URL(path, base), {
          method,
          headers: {
            ...(withCookie && { cookie }),
            ...(body !== undefined && { 'content-type': 'application/json' }),
            ...(write && method !== 'GET' && { 'x-robota-api': '1' }),
          },
          ...(body !== undefined && { body: JSON.stringify(body) }),
        });
        return { status: response.status, body: await response.json().catch(() => null) };
      },
    };
  }

  it('reads the limits, today’s count and what waits for the digest, and saves a partial change', async () => {
    const { started } = await start({ gui: true });
    const api = await client(started);
    expect(await api.send('GET', 'delivery')).toEqual({
      status: 200,
      body: { settings: DEFAULTS, today: { sent: 0, limit: 3 }, waitingInDigest: 0 },
    });

    const saved = await api.send('PUT', 'delivery', {
      dailyLimit: 5,
      quietHours: { from: '23:30' },
      digest: { enabled: false },
    });
    const expected = {
      dailyLimit: 5,
      quietHours: { enabled: true, from: '23:30', to: '08:00' },
      digest: { enabled: false, at: '08:00' },
    };
    expect(saved).toEqual({
      status: 200,
      body: { settings: expected, today: { sent: 0, limit: 5 }, waitingInDigest: 0 },
    });
    expect((await api.send('GET', 'delivery')).body.settings).toEqual(expected);

    const path = join(started.stateDir, 'delivery', 'settings.json');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(expected);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    // A limit of 0 is allowed: nothing is pushed immediately.
    expect((await api.send('PUT', 'delivery', { dailyLimit: 0 })).body.today.limit).toBe(0);
  });

  it('refuses a change that is not valid in plain words, and keeps the limits as they were', async () => {
    const { started } = await start({ gui: true });
    const api = await client(started);
    const refusals: [unknown, RegExp][] = [
      [{ dailyLimit: 2.5 }, /whole number from 0 to 20/u],
      [{ dailyLimit: 21 }, /whole number from 0 to 20/u],
      [{ dailyLimit: -1 }, /whole number from 0 to 20/u],
      [{ dailyLimit: '3' }, /whole number from 0 to 20/u],
      [{ quietHours: { from: '25:00' } }, /Quiet hours start must be a time of day as HH:MM/u],
      [{ quietHours: { to: '8:00' } }, /Quiet hours end must be a time of day as HH:MM/u],
      [{ digest: { at: '12:60' } }, /digest time must be a time of day as HH:MM/u],
      [{ quietHours: { enabled: 'yes' } }, /true or false/u],
      [{ digest: { enabled: 1 } }, /true or false/u],
      [{ volume: 11 }, /no setting named volume/u],
      [{ digest: { when: '09:00' } }, /no setting named when/u],
      [{ quietHours: { from: '08:00' } }, /start and end at different times/u],
      [{ dailyLimit: 4, digest: { at: 'noon' } }, /digest time must be a time of day/u],
      [[1, 2], /must be an object/u],
    ];
    for (const [body, message] of refusals) {
      const refused = await api.send('PUT', 'delivery', body);
      expect(refused.status, JSON.stringify(body)).toBe(400);
      expect(refused.body.error, JSON.stringify(body)).toMatch(message);
    }
    expect((await api.send('GET', 'delivery')).body.settings).toEqual(DEFAULTS);
    expect(existsSync(join(started.stateDir, 'delivery', 'settings.json'))).toBe(false);
  });

  it('answers only the person’s own browser: the cookie and the write header are both needed', async () => {
    const { started } = await start({ gui: true });
    const api = await client(started);
    expect((await api.send('GET', 'delivery', undefined, { cookie: false })).status).toBe(403);
    const body = { dailyLimit: 20 };
    expect((await api.send('PUT', 'delivery', body, { cookie: false })).status).toBe(403);
    expect((await api.send('PUT', 'delivery', body, { write: false })).status).toBe(403);
    expect((await started.capabilities.delivery.status()).settings).toEqual(DEFAULTS);
  });
});

describe('what the agent can reach', () => {
  const NAMES = /deliver|quiet|digest|daily|limit|notif|setting|webhook/iu;

  it('offers no tool, in any run, that reads or changes the limits', async () => {
    const { started } = await start();
    const sent = started.capabilities.tools.map((tool) => tool.schema.name);
    expect(sent.filter((name) => NAMES.test(name))).toEqual([]);
    for (const tool of started.capabilities.tools) {
      const schema = JSON.stringify(tool.schema.parameters ?? {});
      expect(schema, tool.schema.name).not.toMatch(/dailyLimit|quietHours|webhook/iu);
    }
    // What a run is allowed to call is a short list of names, none of them about the limits.
    for (const name of [...syncRunTools(), ...caseTurnTools()]) {
      expect(name).not.toMatch(NAMES);
      expect(sent, name).toContain(name);
    }
    started.model.script({ text: 'Hello.' });
    await started.submit('Hello');
    expect(offeredTools(started.model.requests[0]!).filter((name) => NAMES.test(name))).toEqual([]);
  });

  it('says nothing of the limits in any instruction or tool description it is given', async () => {
    const { started } = await start();
    const { cases } = started.capabilities;
    const { case: opened } = await cases.open({
      title: 'A case',
      noticed: 'Something happened.',
      source: 'mail:1',
    });
    const { item } = await cases.ask(opened.id, { question: 'Was this you?', options: ['Yes'] });
    await cases.answer(item.id, { choice: 'Yes' });
    const connector = {
      id: 'connector-mail-1',
      title: 'Mail',
      kind: 'mail',
    } as unknown as IConnector;
    const texts = [
      started.capabilities.instructions,
      CASE_INSTRUCTIONS,
      caseTurnInstructions((await cases.get(opened.id))!),
      syncRunInstructions(connector, undefined),
      ...started.capabilities.tools.map((tool) => tool.schema.description ?? ''),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(
        /dailyLimit|quietHours|delivery settings|settings\.json|\/delivery|webhook|notification address/iu,
      );
    }
  });

  it('cannot raise its own limit: a call to ask that names a limit, or a question that asks for one, changes nothing', async () => {
    const { started, channel } = await start();
    await askInChat(started, 'Raise my daily limit to 20 and turn quiet hours off', {
      urgency: 'now',
      dailyLimit: 20,
      quietHours: { enabled: false },
      settings: { dailyLimit: 20 },
    });
    expect((await status(started)).settings).toEqual(DEFAULTS);
    expect(channel.sent).toHaveLength(1);
    expect(existsSync(join(started.stateDir, 'delivery', 'settings.json'))).toBe(false);
  });
});
