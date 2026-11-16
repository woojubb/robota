/**
 * Which of the agent's questions reach the person beyond the feed: the agent suggests an urgency, the
 * person's own limits decide. The first group runs the whole agent against a scripted model with a
 * fixture channel standing in for a messenger and a clock the test moves; the second group is the
 * person's own routes to the limits; the third is what the agent can and cannot reach.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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

import type { IConnector, IFixtureChannel } from '@robota-sdk/agent-product/personal';
import type { IHarness } from './harness.js';
import type { IModelRequest } from './scripted-model.js';

/** A local time on the sixteenth of November, or on `day`: delivery reads the machine's own clock. */
const at = (hours: number, minutes = 0, day = 16): Date => new Date(2026, 10, day, hours, minutes);

const POINTER = 'Open your Feed to answer.';
const DEFAULTS = {
  dailyLimit: 3,
  quietHours: { enabled: true, from: '22:00', to: '08:00' },
  digest: { enabled: true, at: '08:00' },
};
const clock = { now: at(10) };

let harness: IHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
  clock.now = at(10);
});

async function start(
  options: { channel?: boolean; gui?: boolean } = {},
): Promise<{ started: IHarness; channel: IFixtureChannel }> {
  harness = await startHarness({
    deliveryClock: () => clock.now,
    ...(options.gui === true && { gui: true, webRoot: createFixtureWebRoot() }),
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

async function until(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
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

  it('reaches the channel from a case turn too, which is a run in the background', async () => {
    const { started, channel } = await start();
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
    started.model.script(
      {
        tool: 'CaseAsk',
        args: {
          id: opened.id,
          question: 'Have you signed out the other sessions?',
          options: ['Yes', 'Not yet'],
          urgency: 'now',
        },
      },
      { text: 'I asked about the other sessions.' },
    );
    const answered = await started.capabilities.api({
      method: 'POST',
      path: `/feed/${item.id}/answer`,
      segments: ['feed', item.id, 'answer'],
      query: new URLSearchParams(),
      body: { choice: 'No' },
    });
    expect(answered.status).toBe(200);
    const pushed = () => channel.sent.filter((message) => message.text.endsWith(`\n${POINTER}`));
    await until(() => pushed().length > 0, 'the follow-up question on the channel');
    await started.capabilities.runner()!.settled();
    await started.capabilities.delivery.idle();
    // The run's own report is another matter; the question is pushed once.
    expect(pushed()).toEqual([
      {
        conversationId: 'dm',
        text: `New sign-in from Lagos: Have you signed out the other sessions?\n${POINTER}`,
      },
    ]);
    expect((await goals.feed()).filter((entry) => entry.question?.state === 'open')).toHaveLength(
      1,
    );
  });

  it('is held for the digest once the limit is reached, and reaches the channel only through it', async () => {
    const { started, channel } = await start();
    const put = await started.capabilities.api({
      method: 'PUT',
      path: '/delivery',
      segments: ['delivery'],
      query: new URLSearchParams(),
      body: { dailyLimit: 1 },
    });
    expect(put.status).toBe(200);
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
  const NAMES = /deliver|quiet|digest|daily|limit|notif|setting/iu;

  it('offers no tool, in any run, that reads or changes the limits', async () => {
    const { started } = await start();
    const sent = started.capabilities.tools.map((tool) => tool.schema.name);
    expect(sent.filter((name) => NAMES.test(name))).toEqual([]);
    for (const tool of started.capabilities.tools) {
      const schema = JSON.stringify(tool.schema.parameters ?? {});
      expect(schema, tool.schema.name).not.toMatch(/dailyLimit|quietHours/u);
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
        /dailyLimit|quietHours|delivery settings|settings\.json|\/delivery/iu,
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
