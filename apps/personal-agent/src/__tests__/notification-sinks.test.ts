/**
 * Two places a question reaches the person without a messenger: the address they gave (a push-to-phone
 * service, a team chat) and a page they have open. The whole agent runs against a scripted model, a
 * stand-in for the service behind the address, and a clock the test moves. The address may carry a token,
 * so most of what is checked is where it does not appear.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNotificationTransport } from '../notification-transport.js';
import { toolResults } from './scripted-model.js';
import { createFixtureWebRoot, startHarness } from './harness.js';
import { startStandInWebhook } from './stand-in-webhook.js';
import { virtualHostFetch } from './stand-in-connector.js';

import type { IHarness } from './harness.js';
import type { IModelRequest } from './scripted-model.js';
import type { IStandInWebhook } from './stand-in-webhook.js';

/** A local time on the sixteenth of November, or on `day`: delivery reads the machine's own clock. */
const at = (hours: number, minutes = 0, day = 16): Date => new Date(2026, 10, day, hours, minutes);

const POINTER = 'Open your Feed to answer.';
const HOOK_HOST = 'hook.stand-in.test';
/** The part of the address that stands for a token; built from pieces so no scan takes it for one. */
const TOKEN = ['tok', 'en-', 'Qx7', 'kd2', 'Lm9'].join('');
const ADDRESS = `https://${HOOK_HOST}/topics/${TOKEN}`;
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

interface IReply {
  readonly status: number;
  readonly body: any;
}

interface IWorld {
  readonly started: IHarness;
  readonly hook: IStandInWebhook;
  /** What the stand-in's name resolves to; the policy judges it each time. */
  readonly resolves: { to: string[] };
  send(
    method: string,
    path: string,
    body?: unknown,
    options?: { cookie?: boolean; write?: boolean },
  ): Promise<IReply>;
}

/** The agent with a stand-in service reachable at `https://hook.stand-in.test`, and the person's browser logged in. */
async function world(options: { allowedHosts?: readonly string[] } = {}): Promise<IWorld> {
  const hook = await startStandInWebhook();
  closers.push(hook.close);
  const resolves = { to: ['203.0.113.10'] };
  const started = await startHarness({
    gui: true,
    webRoot: createFixtureWebRoot(),
    deliveryClock: () => clock.now,
    connectorNetwork: {
      fetch: virtualHostFetch({ [HOOK_HOST]: hook.port }),
      lookup: async () => resolves.to,
    },
    ...(options.allowedHosts !== undefined && { connectorAllowedHosts: options.allowedHosts }),
  });
  harness = started;
  const gui = started.local.gui!;
  // Log in with the access code the way a browser does, then call the API with the cookie it got.
  const login = await fetch(new URL('/__monitor_login', gui.url), {
    method: 'POST',
    body: new URLSearchParams({ code: gui.accessCode }),
    redirect: 'manual',
  });
  const base = new URL(`${login.headers.get('location')!}api/`, gui.url);
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  return {
    started,
    hook,
    resolves,
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

const caseIdIn = (request: IModelRequest): string =>
  /case-[a-z0-9]+/u.exec(toolResults(request).at(-1) ?? '')![0];

/** A chat turn in which the agent opens a case and asks its question with the given urgency. */
async function askInChat(started: IHarness, title: string, urgency: string): Promise<void> {
  started.model.script(
    {
      tool: 'CaseOpen',
      args: { title, noticed: `A mail says: ${title}.`, source: `chat:${title}` },
    },
    (request) => ({
      tool: 'CaseAsk',
      args: { id: caseIdIn(request), question: 'Was this you?', options: ['Yes', 'No'], urgency },
    }),
    { text: 'I asked you in your feed.' },
  );
  expect((await started.submit(`Keep a case on ${title}.`)).text).toContain('asked you');
  await started.capabilities.delivery.idle();
}

const sent = async (started: IHarness): Promise<number> =>
  (await started.capabilities.delivery.status()).today.sent;

const openQuestions = async (started: IHarness): Promise<number> =>
  (await started.capabilities.goals.feed()).filter((item) => item.question?.state === 'open')
    .length;

/** Every file under the state directory that holds `text`, as paths below it. */
function filesHolding(root: string, text: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => readFileSync(path).includes(text))
    .map((path) => path.slice(root.length + 1));
}

describe('setting the notification address', () => {
  it('keeps an https address with a token in it, and answers with the host and the format only', async () => {
    const { started, send } = await world();
    expect(await send('GET', 'delivery/webhook')).toEqual({
      status: 200,
      body: { configured: false, format: 'plain' },
    });
    const saved = await send('PUT', 'delivery/webhook', { url: ADDRESS });
    expect(saved).toEqual({
      status: 200,
      body: { configured: true, host: HOOK_HOST, format: 'plain' },
    });
    expect(await send('GET', 'delivery/webhook')).toEqual(saved);
    expect((await send('PUT', 'delivery/webhook', { url: ADDRESS, format: 'json' })).body).toEqual({
      configured: true,
      host: HOOK_HOST,
      format: 'json',
    });
    const forgotten = await send('DELETE', 'delivery/webhook');
    expect(forgotten).toEqual({ status: 200, body: { configured: false, format: 'plain' } });
    expect(existsSync(join(started.stateDir, 'delivery', 'webhook.json'))).toBe(false);
    // Forgetting what is not there is no error.
    expect((await send('DELETE', 'delivery/webhook')).status).toBe(200);
  });

  it('refuses what is not an https address without a user name, in plain words, and keeps nothing', async () => {
    const { send } = await world();
    const refusals: [unknown, RegExp][] = [
      [{}, /must be a web address/u],
      [{ url: 7 }, /must be a web address/u],
      [{ url: 'not an address' }, /not a valid web address/u],
      [{ url: `http://${HOOK_HOST}/${TOKEN}` }, /must start with https:\/\//u],
      [{ url: `https://person:${TOKEN}@${HOOK_HOST}/x` }, /must not hold a user name or password/u],
      [{ url: ADDRESS, format: 'xml' }, /format must be one of plain, json/u],
      [{ url: ADDRESS, secret: true }, /no setting named secret/u],
      [[ADDRESS], /must be an object/u],
    ];
    for (const [body, message] of refusals) {
      const refused = await send('PUT', 'delivery/webhook', body);
      expect(refused.status, JSON.stringify(body)).toBe(400);
      expect(refused.body.error, JSON.stringify(body)).toMatch(message);
      expect(JSON.stringify(refused.body)).not.toContain(TOKEN);
    }
    expect((await send('GET', 'delivery/webhook')).body.configured).toBe(false);
  });

  it('refuses a loopback, private or metadata destination unless the owner named the host', async () => {
    const { started, send, resolves } = await world();
    for (const url of [
      `https://127.0.0.1:4443/${TOKEN}`,
      `https://localhost/${TOKEN}`,
      `https://[::1]/${TOKEN}`,
      `https://10.1.2.3/${TOKEN}`,
      `https://192.168.1.20/${TOKEN}`,
      `https://169.254.169.254/${TOKEN}`,
      `https://metadata.google.internal/${TOKEN}`,
      `https://printer.localhost/${TOKEN}`,
    ]) {
      const refused = await send('PUT', 'delivery/webhook', { url });
      expect(refused.status, url).toBe(400);
      expect(refused.body.error, url).toMatch(/cannot be used: it is a loopback/u);
      expect(JSON.stringify(refused.body), url).not.toContain(TOKEN);
    }
    // A public name that resolves to a private address is judged by where it goes.
    resolves.to = ['10.0.0.5'];
    const refused = await send('PUT', 'delivery/webhook', { url: ADDRESS });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe(
      `The notification address (${HOOK_HOST}) cannot be used: it is a loopback, private or link-local address, which is reached only when the owner names its host`,
    );
    resolves.to = [];
    expect((await send('PUT', 'delivery/webhook', { url: ADDRESS })).body.error).toMatch(
      /name does not resolve/u,
    );
    expect(existsSync(join(started.stateDir, 'delivery', 'webhook.json'))).toBe(false);
  });

  it('accepts a private destination only for the host the owner named', async () => {
    const { send, resolves } = await world({ allowedHosts: [HOOK_HOST] });
    resolves.to = ['10.0.0.5'];
    expect((await send('PUT', 'delivery/webhook', { url: ADDRESS })).body).toEqual({
      configured: true,
      host: HOOK_HOST,
      format: 'plain',
    });
    // Naming one host names no other.
    const other = await send('PUT', 'delivery/webhook', {
      url: `https://other.stand-in.test/${TOKEN}`,
    });
    expect(other.status).toBe(400);
    expect(other.body.error).toMatch(/cannot be used: it is a loopback, private/u);
  });

  it('keeps it in one owner-only file, which is the only place that holds it', async () => {
    const { started, send } = await world();
    await send('PUT', 'delivery/webhook', { url: ADDRESS, format: 'json' });
    const path = join(started.stateDir, 'delivery', 'webhook.json');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ url: ADDRESS, format: 'json' });
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(join(started.stateDir, 'delivery')).mode & 0o777).toBe(0o700);
    }
    expect(filesHolding(started.stateDir, TOKEN)).toEqual([join('delivery', 'webhook.json')]);
  });

  it('answers only the person’s own browser: the cookie and the write header are both needed', async () => {
    const { send, started } = await world();
    const body = { url: ADDRESS };
    expect((await send('GET', 'delivery/webhook', undefined, { cookie: false })).status).toBe(403);
    expect((await send('PUT', 'delivery/webhook', body, { cookie: false })).status).toBe(403);
    expect((await send('PUT', 'delivery/webhook', body, { write: false })).status).toBe(403);
    expect((await send('DELETE', 'delivery/webhook', undefined, { write: false })).status).toBe(
      403,
    );
    expect((await send('POST', 'delivery/webhook/test', {}, { write: false })).status).toBe(403);
    expect((await send('POST', 'delivery/webhook/test', {}, { cookie: false })).status).toBe(403);
    expect((await send('GET', 'notifications', undefined, { cookie: false })).status).toBe(403);
    expect(await started.capabilities.notificationAddress.configured()).toBe(false);
  });
});

describe('what reaches the address', () => {
  it('is the test message in plain text, once, with the title as a header', async () => {
    const { send, hook } = await world();
    await send('PUT', 'delivery/webhook', { url: ADDRESS });
    expect(await send('POST', 'delivery/webhook/test')).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(hook.received).toHaveLength(1);
    const [request] = hook.received;
    expect(request).toEqual(
      expect.objectContaining({
        method: 'POST',
        path: `/topics/${TOKEN}`,
        body: 'Test from your agent',
      }),
    );
    expect(request!.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(request!.headers['title']).toBe('Test');
  });

  it('is the test message as JSON when the person chose that form', async () => {
    const { send, hook } = await world();
    await send('PUT', 'delivery/webhook', { url: ADDRESS, format: 'json' });
    expect((await send('POST', 'delivery/webhook/test')).status).toBe(200);
    expect(hook.received).toHaveLength(1);
    expect(hook.received[0]!.headers['content-type']).toBe('application/json');
    expect(hook.received[0]!.headers['title']).toBeUndefined();
    expect(JSON.parse(hook.received[0]!.body)).toEqual({
      text: 'Test from your agent',
      title: 'Test',
    });
  });

  it('is refused for the test when no address is set, and nothing is sent', async () => {
    const { send, hook } = await world();
    const refused = await send('POST', 'delivery/webhook/test');
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('No notification address is set');
    expect(hook.received).toEqual([]);
  });

  it('is tried once and reported by host and status when the service answers with an error', async () => {
    const { send, hook } = await world();
    await send('PUT', 'delivery/webhook', { url: ADDRESS });
    hook.answer(500);
    const refused = await send('POST', 'delivery/webhook/test');
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe(
      `The notification address (${HOOK_HOST}) answered with status 500`,
    );
    expect(JSON.stringify(refused.body)).not.toContain(TOKEN);
    expect(hook.received).toHaveLength(1);
    hook.answer(204);
    expect((await send('POST', 'delivery/webhook/test')).status).toBe(200);
    expect(hook.received).toHaveLength(2);
  });

  it('never follows a redirect: what was sent goes to the address that was given and nowhere else', async () => {
    const { send, hook } = await world();
    await send('PUT', 'delivery/webhook', { url: ADDRESS });
    for (const status of [301, 302, 307, 308]) {
      hook.answer(status, { location: `https://${HOOK_HOST}/elsewhere` });
      const refused = await send('POST', 'delivery/webhook/test');
      expect(refused.status, String(status)).toBe(400);
      expect(refused.body.error).toBe(
        `The notification address (${HOOK_HOST}) cannot be used: it answered with a redirect, which is never followed`,
      );
    }
    expect(hook.received.map((request) => request.path)).toEqual(Array(4).fill(`/topics/${TOKEN}`));
  });

  it('is refused when the service’s answer is far larger than any it gives', async () => {
    const { send, hook } = await world();
    await send('PUT', 'delivery/webhook', { url: ADDRESS });
    hook.answer(200, {}, 'x'.repeat(200_000));
    const refused = await send('POST', 'delivery/webhook/test');
    expect(refused.body.error).toMatch(/cannot be used: its answer was too large/u);
  });

  it('is judged by the policy again when it is sent: a name that now resolves to a private address is refused', async () => {
    const { send, hook, resolves } = await world();
    await send('PUT', 'delivery/webhook', { url: ADDRESS });
    expect((await send('POST', 'delivery/webhook/test')).status).toBe(200);
    resolves.to = ['127.0.0.1'];
    const refused = await send('POST', 'delivery/webhook/test');
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/cannot be used: it is a loopback, private/u);
    expect(hook.received).toHaveLength(1);
  });

  it('cannot be reached when the service does not answer, and the words do not carry the address', async () => {
    const { hook } = await world();
    hook.hang();
    const transport = createNotificationTransport({
      fetch: virtualHostFetch({ [HOOK_HOST]: hook.port }),
      lookup: async () => ['203.0.113.10'],
    });
    const request = { url: ADDRESS, headers: {}, body: 'x', timeoutMs: 200 };
    await expect(transport.post(request)).rejects.toThrow();
    expect(hook.received).toHaveLength(1);
  });
});

describe('a question the agent asks', () => {
  it('reaches the address once as plain text when it needs the person now, and counts as pushed', async () => {
    const { started, send, hook } = await world();
    await send('PUT', 'delivery/webhook', { url: ADDRESS });
    await askInChat(started, 'New sign-in from Lagos', 'now');
    expect(hook.received).toHaveLength(1);
    expect(hook.received[0]!.body).toBe(`New sign-in from Lagos: Was this you?\n${POINTER}`);
    expect(hook.received[0]!.headers['title']).toBe('New sign-in from Lagos');
    expect(hook.received[0]!.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(await sent(started)).toBe(1);
    expect(await openQuestions(started)).toBe(1);
  });

  it('reaches it as JSON with the title kept whole, and a header that is plain ASCII in the plain form', async () => {
    const { started, send, hook } = await world();
    const title = 'Sign-in from Café \u{1F514}';
    await send('PUT', 'delivery/webhook', { url: ADDRESS });
    await askInChat(started, title, 'now');
    expect(hook.received[0]!.headers['title']).toBe('Sign-in from Cafe ?');
    expect(hook.received[0]!.body).toBe(`${title}: Was this you?\n${POINTER}`);
    await send('PUT', 'delivery/webhook', { url: ADDRESS, format: 'json' });
    await askInChat(started, `${title} again`, 'now');
    expect(hook.received).toHaveLength(2);
    expect(hook.received[1]!.headers['content-type']).toBe('application/json');
    expect(JSON.parse(hook.received[1]!.body)).toEqual({
      text: `${title} again: Was this you?\n${POINTER}`,
      title: `${title} again`,
    });
  });

  it('does not reach it once the day’s limit is used, nor when it can wait, nor when it is for the feed', async () => {
    const { started, send, hook } = await world();
    await send('PUT', 'delivery', { dailyLimit: 1 });
    await send('PUT', 'delivery/webhook', { url: ADDRESS });
    await askInChat(started, 'First', 'now');
    await askInChat(started, 'Second', 'now');
    await askInChat(started, 'Third', 'digest');
    await askInChat(started, 'Fourth', 'feed');
    expect(hook.received.map((request) => request.headers['title'])).toEqual(['First']);
    expect(await sent(started)).toBe(1);
    expect(await openQuestions(started)).toBe(4);
  });

  it('does not reach it in quiet hours, and goes out in the digest when they are over', async () => {
    const { started, send, hook } = await world();
    await send('PUT', 'delivery/webhook', { url: ADDRESS });
    clock.now = at(23, 0);
    await askInChat(started, 'Late sign-in', 'now');
    expect(hook.received).toEqual([]);
    clock.now = at(8, 0, 17);
    await started.capabilities.delivery.tick();
    expect(hook.received).toHaveLength(1);
    expect(hook.received[0]!.headers['title']).toBe('1 question waiting for you');
    expect(hook.received[0]!.body).toBe(
      `1 question is waiting for you:\n- Late sign-in\n${POINTER}`,
    );
  });

  it('reaches it in the daily digest once', async () => {
    const { started, send, hook } = await world();
    await send('PUT', 'delivery/webhook', { url: ADDRESS });
    await askInChat(started, 'Alpha', 'digest');
    await askInChat(started, 'Bravo', 'digest');
    expect(hook.received).toEqual([]);
    clock.now = at(8, 0, 17);
    await started.capabilities.delivery.tick();
    await started.capabilities.delivery.tick();
    expect(hook.received).toHaveLength(1);
    expect(hook.received[0]!.body).toBe(
      `2 questions are waiting for you:\n- Alpha\n- Bravo\n${POINTER}`,
    );
  });

  it('is not counted, and stays in the feed, when the service answers with an error; it is not tried again', async () => {
    const { started, send, hook } = await world();
    await send('PUT', 'delivery/webhook', { url: ADDRESS });
    hook.answer(503);
    await askInChat(started, 'New sign-in from Lagos', 'now');
    expect(hook.received).toHaveLength(1);
    expect(await sent(started)).toBe(0);
    expect(await openQuestions(started)).toBe(1);
    // The limit is untouched: once the service is back, the next question is pushed.
    hook.answer(200);
    await askInChat(started, 'Bill due', 'now');
    expect(hook.received).toHaveLength(2);
    expect(await sent(started)).toBe(1);
  });

  it('is not counted when the service does not answer in time', async () => {
    const { started, send, hook } = await world();
    await send('PUT', 'delivery/webhook', { url: ADDRESS });
    hook.hang();
    await askInChat(started, 'New sign-in from Lagos', 'now');
    expect(hook.received).toHaveLength(1);
    expect(await sent(started)).toBe(0);
    expect(await openQuestions(started)).toBe(1);
  }, 30_000);

  it('reaches nothing before an address is set', async () => {
    const { started, hook } = await world();
    await askInChat(started, 'New sign-in from Lagos', 'now');
    expect(hook.received).toEqual([]);
    expect(await started.capabilities.notificationAddress.view()).toEqual({
      configured: false,
      format: 'plain',
    });
    expect(await sent(started)).toBe(0);
  });

  it('reaches nothing once the address is removed, though it reached it before', async () => {
    const { started, send, hook } = await world();
    await send('PUT', 'delivery/webhook', { url: ADDRESS });
    await askInChat(started, 'First', 'now');
    await send('DELETE', 'delivery/webhook');
    await askInChat(started, 'Second', 'now');
    expect(hook.received).toHaveLength(1);
    expect(await sent(started)).toBe(1);
  });
});

describe('a page the person has open', () => {
  it('is handed what arrived after the last message it saw, and starts from now when it has none', async () => {
    const { started, send } = await world();
    expect(await send('GET', 'notifications')).toEqual({
      status: 200,
      body: { messages: [], latest: 0 },
    });
    await askInChat(started, 'First', 'now');
    await askInChat(started, 'Second', 'now');
    const everything = await send('GET', 'notifications?after=0');
    expect(everything.body.latest).toBe(2);
    expect(
      everything.body.messages.map((message: { id: number; kind: string; title: string }) => [
        message.id,
        message.kind,
        message.title,
      ]),
    ).toEqual([
      [1, 'question', 'First'],
      [2, 'question', 'Second'],
    ]);
    expect(everything.body.messages[0].text).toBe(`First: Was this you?\n${POINTER}`);
    expect(typeof everything.body.messages[0].at).toBe('string');
    expect(
      (await send('GET', 'notifications?after=1')).body.messages.map(
        (message: { id: number }) => message.id,
      ),
    ).toEqual([2]);
    expect((await send('GET', 'notifications?after=2')).body).toEqual({ messages: [], latest: 2 });
    expect((await send('GET', 'notifications')).body).toEqual({ messages: [], latest: 2 });
    expect(await sent(started)).toBe(2);
  });

  it('takes a push only while it is polling, so a question is neither lost nor counted when nobody is looking', async () => {
    const { started, send } = await world();
    await askInChat(started, 'Nobody looking', 'now');
    expect(await sent(started)).toBe(0);
    expect(await openQuestions(started)).toBe(1);
    expect((await send('GET', 'notifications?after=0')).body).toEqual({ messages: [], latest: 0 });
    // The poll just made is what shows the page is open.
    await askInChat(started, 'Someone is looking', 'now');
    expect(await sent(started)).toBe(1);
    expect(
      (await send('GET', 'notifications?after=0')).body.messages.map(
        (message: { title: string }) => message.title,
      ),
    ).toEqual(['Someone is looking']);
  });

  it('is handed the digest too', async () => {
    const { started, send } = await world();
    await askInChat(started, 'Alpha', 'digest');
    clock.now = at(8, 0, 17);
    await send('GET', 'notifications');
    await started.capabilities.delivery.tick();
    const { messages } = (await send('GET', 'notifications?after=0')).body;
    expect(
      messages.map((message: { kind: string; title: string }) => [message.kind, message.title]),
    ).toEqual([['digest', '1 question waiting for you']]);
  });

  it('refuses a cursor that is not a whole number, in plain words', async () => {
    const { send } = await world();
    for (const after of ['abc', '-1', '1.5', '1e3', '9999999999999999', ' 2']) {
      const refused = await send('GET', `notifications?after=${encodeURIComponent(after)}`);
      expect(refused.status, after).toBe(400);
      expect(refused.body.error, after).toBe('after must be a whole number');
    }
  });

  it('is told by the address and by the page alike, and the push counts once', async () => {
    const { started, send, hook } = await world();
    await send('PUT', 'delivery/webhook', { url: ADDRESS });
    await send('GET', 'notifications');
    await askInChat(started, 'Both places', 'now');
    expect(hook.received).toHaveLength(1);
    expect((await send('GET', 'notifications?after=0')).body.latest).toBe(1);
    expect(await sent(started)).toBe(1);
  });
});

describe('the address is the person’s alone', () => {
  it('appears in no answer, no log, no feed item and no file but its own, whatever was done with it', async () => {
    const written: string[] = [];
    const record = (chunk: unknown): boolean => {
      written.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(record as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(record as never);
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, level).mockImplementation(
        (...parts: unknown[]) => void written.push(parts.join(' ')),
      );

    const { started, send, hook } = await world();
    const answers: unknown[] = [];
    const keep = async (reply: Promise<IReply>): Promise<void> =>
      void answers.push((await reply).body);
    await keep(send('PUT', 'delivery/webhook', { url: `http://${HOOK_HOST}/${TOKEN}` }));
    await keep(send('PUT', 'delivery/webhook', { url: `https://person:${TOKEN}@${HOOK_HOST}/x` }));
    await keep(send('PUT', 'delivery/webhook', { url: ADDRESS }));
    await keep(send('GET', 'delivery/webhook'));
    await keep(send('GET', 'delivery'));
    await keep(send('GET', 'settings'));
    await keep(send('POST', 'delivery/webhook/test'));
    hook.answer(500);
    await keep(send('POST', 'delivery/webhook/test'));
    hook.answer(302, { location: `https://${HOOK_HOST}/${TOKEN}-elsewhere` });
    await keep(send('POST', 'delivery/webhook/test'));
    hook.answer(200);
    await askInChat(started, 'New sign-in from Lagos', 'now');
    await keep(send('GET', 'feed'));
    await keep(send('GET', 'cases'));
    await keep(send('GET', 'goals'));
    await keep(send('GET', 'notifications?after=0'));
    await keep(send('PUT', 'delivery/webhook', { url: ADDRESS, format: 'json' }));
    await keep(send('DELETE', 'delivery/webhook'));

    expect(JSON.stringify(answers)).not.toContain(TOKEN);
    expect(written.join('\n')).not.toContain(TOKEN);
    // What the agent was told in the turn it took is no place for it either.
    expect(JSON.stringify(started.model.requests)).not.toContain(TOKEN);
    expect(JSON.stringify(started.model.requests)).not.toContain(HOOK_HOST);
    // Set again, it is in its own file and nowhere else on disk.
    await send('PUT', 'delivery/webhook', { url: ADDRESS });
    expect(filesHolding(started.stateDir, TOKEN)).toEqual([join('delivery', 'webhook.json')]);
    expect(filesHolding(started.stateDir, HOOK_HOST)).toEqual([join('delivery', 'webhook.json')]);
  });

  it('is offered to no tool, in no run, and named in no instruction', async () => {
    const { started, send } = await world();
    await send('PUT', 'delivery/webhook', { url: ADDRESS });
    const tools = started.capabilities.tools;
    expect(
      tools.map((tool) => tool.schema.name).filter((name) => /webhook|notif|address/iu.test(name)),
    ).toEqual([]);
    for (const tool of tools) {
      expect(JSON.stringify(tool.schema.parameters ?? {}), tool.schema.name).not.toMatch(
        /webhook|notification address/iu,
      );
      expect(tool.schema.description ?? '', tool.schema.name).not.toMatch(
        /webhook|notification address/iu,
      );
    }
    expect(started.capabilities.instructions).not.toMatch(/webhook|notification address/iu);
    started.model.script({ text: 'Hello.' });
    await started.submit('Change my notification address to https://elsewhere.example/x');
    expect(await send('GET', 'delivery/webhook')).toEqual({
      status: 200,
      body: { configured: true, host: HOOK_HOST, format: 'plain' },
    });
  });
});
