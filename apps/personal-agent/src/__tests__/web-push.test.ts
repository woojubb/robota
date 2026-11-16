/**
 * Web Push: a question reaches the person's browser while its page is closed. The message is checked the
 * way a browser would read it (decrypted with the subscription's own keys, its VAPID signature verified),
 * against the standards' own example for the decryptor itself; the whole agent runs against a scripted
 * model, a stand-in for the browser's push service and a clock the test moves. A push address is a
 * capability, so most of what is checked is where it does not appear.
 */
import { createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildPushRequest } from '../push/push-request.js';
import { FEED_URL } from '../push/push-sink.js';
import { VAPID_SUBJECT } from '../push/vapid.js';
import { decryptPush, newBrowserKeys, subscriptionOf } from './push-decrypt.js';
import { toolResults } from './scripted-model.js';
import { createFixtureWebRoot, startHarness } from './harness.js';
import { startStandInPushService } from './stand-in-push-service.js';
import { startStandInWebhook } from './stand-in-webhook.js';
import { virtualHostFetch } from './stand-in-connector.js';

import type { IBrowserKeys } from './push-decrypt.js';
import type { IHarness } from './harness.js';
import type { IModelRequest } from './scripted-model.js';
import type { IReceivedPush, IStandInPushService } from './stand-in-push-service.js';
import type { IStandInWebhook } from './stand-in-webhook.js';

/** The example in RFC 8291: the browser's keys and the message its sender produced. Built from pieces so no scan takes them for secrets. */
const RFC_BROWSER_PUBLIC = [
  'BCVxsr7N_eNgVRqv',
  'HtD0zTZsEc6-VV-J',
  'vLexhqUzORcxaOzi',
  '6-AYWXvTBHm4bjyP',
  'js7Vd8pZGH6SRpkN',
  'toIAiw4',
].join('');
const RFC_BROWSER_PRIVATE = ['q1dXpw3UpT5VOmu_', 'cf_v6ih07Aems3nj', 'xI-JWgLcM94'].join('');
const RFC_AUTH_SECRET = ['BTBZMqHH6r4Tts7J', '_aSIgg'].join('');
const RFC_BODY = [
  'DGv6ra1nlYgDCS1F',
  'RnbzlwAAEABBBP4z',
  '9KsN6nGRTbVYI_c7',
  'VJSPQTBtkgcy27ml',
  'mlMoZIIgDll6e3vC',
  'YLocInmYWAmS6Tlz',
  'AC8wEqKK6PBru3jl',
  '7A_yl95bQpu6cVPT',
  'pK4Mqgkf1CXztLVB',
  'St2Ks3oZwbuwXPXL',
  'WyouBWLVWGNWQexS',
  'gSxsj_Qulcy4a-fN',
].join('');
const RFC_BROWSER: IBrowserKeys = {
  private: Buffer.from(RFC_BROWSER_PRIVATE, 'base64url'),
  public: Buffer.from(RFC_BROWSER_PUBLIC, 'base64url'),
  auth: Buffer.from(RFC_AUTH_SECRET, 'base64url'),
};

/** A local time on the sixteenth of November, or on `day`: delivery reads the machine's own clock. */
const at = (hours: number, minutes = 0, day = 16): Date => new Date(2026, 10, day, hours, minutes);

const POINTER = 'Open your Feed to answer.';
const PUSH_HOST = 'push.stand-in.test';
const HOOK_HOST = 'hook.stand-in.test';
/** The part of a push address that stands for its secret; built from pieces so no scan takes it for one. */
const TOKEN = ['tok', 'en-', 'Qx7', 'kd2', 'Lm9'].join('');
const endpointAt = (name: string): string => `https://${PUSH_HOST}/send/${TOKEN}-${name}`;
const pathAt = (name: string): string => `/send/${TOKEN}-${name}`;
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
  readonly push: IStandInPushService;
  readonly hook: IStandInWebhook;
  /** What the stand-in's names resolve to; the policy judges it each time. */
  readonly resolves: { to: string[] };
  send(
    method: string,
    path: string,
    body?: unknown,
    options?: { cookie?: boolean; write?: boolean },
  ): Promise<IReply>;
  /** A browser with keys of its own subscribes at `name` on the push service; its keys. */
  subscribe(name: string): Promise<IBrowserKeys>;
}

/** The agent with a stand-in push service reachable at `https://push.stand-in.test`, and the person's browser logged in. */
async function world(options: { allowedHosts?: readonly string[] } = {}): Promise<IWorld> {
  const push = await startStandInPushService();
  closers.push(push.close);
  const hook = await startStandInWebhook();
  closers.push(hook.close);
  const resolves = { to: ['203.0.113.10'] };
  const started = await startHarness({
    gui: true,
    webRoot: createFixtureWebRoot(),
    deliveryClock: () => clock.now,
    connectorNetwork: {
      fetch: virtualHostFetch({ [PUSH_HOST]: push.port, [HOOK_HOST]: hook.port }),
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
  const send: IWorld['send'] = async (
    method,
    path,
    body,
    { cookie: withCookie = true, write = true } = {},
  ) => {
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
  };
  return {
    started,
    push,
    hook,
    resolves,
    send,
    subscribe: async (name) => {
      const keys = newBrowserKeys();
      const answer = await send('POST', 'push/subscribe', subscriptionOf(endpointAt(name), keys));
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      return keys;
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

/** What the worker in the page receives, read as the browser with `keys` reads it. */
function opened(request: IReceivedPush, keys: IBrowserKeys): Record<string, string> {
  return JSON.parse(decryptPush(request.body, keys).plaintext.toString('utf8')) as Record<
    string,
    string
  >;
}

/** Check a VAPID `Authorization` header the way a push service does, and return its claims. */
function checkVapid(
  authorization: string,
  endpoint: string,
  publicKey: string,
): Record<string, unknown> {
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/u.exec(authorization);
  expect(match, 'a VAPID header').not.toBeNull();
  const [, head, claims, signature, key] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  expect(key).toBe(publicKey);
  expect(JSON.parse(Buffer.from(head, 'base64url').toString('utf8'))).toMatchObject({
    alg: 'ES256',
  });
  const point = Buffer.from(publicKey, 'base64url');
  const verifier = createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url'),
    },
    format: 'jwk',
  });
  expect(
    verify(
      'sha256',
      Buffer.from(`${head}.${claims}`),
      { key: verifier, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    ),
    'a signature by the public key',
  ).toBe(true);
  const parsed = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  expect(parsed['aud']).toBe(new URL(endpoint).origin);
  expect(parsed['sub']).toBe(VAPID_SUBJECT);
  const now = Date.now() / 1000;
  expect(parsed['exp']).toBeGreaterThan(now);
  expect(parsed['exp']).toBeLessThanOrEqual(now + 24 * 60 * 60);
  return parsed;
}

describe('reading a push message the way a browser does', () => {
  it('opens the example in the standard with its own keys, so the reader can be trusted', () => {
    const opened = decryptPush(Buffer.from(RFC_BODY, 'base64url'), RFC_BROWSER);
    expect(opened.plaintext.toString('utf8')).toBe('When I grow up, I want to be a watermelon');
    expect(opened.recordSize).toBe(4096);
    expect(opened.senderKey).toHaveLength(65);
  });

  it('does not open a message with keys that are not the receiver’s', () => {
    expect(() => decryptPush(Buffer.from(RFC_BODY, 'base64url'), newBrowserKeys())).toThrow();
  });
});

describe('the request the agent builds', () => {
  const vapid = { publicKey: '', privateKey: '' };
  const payload = {
    title: 'New sign-in from Lagos',
    text: 'New sign-in from Lagos: Was this you? Open your Feed to answer.',
    tag: 'question-abc',
    url: FEED_URL,
  };

  it('is encrypted to the browser’s own keys, in the standard’s encoding, and only they open it', async () => {
    const { default: webPush } = await import('web-push');
    Object.assign(vapid, webPush.generateVAPIDKeys());
    for (const keys of [RFC_BROWSER, newBrowserKeys()]) {
      const request = buildPushRequest({
        subscription: {
          endpoint: endpointAt('a'),
          keys: {
            p256dh: keys.public.toString('base64url'),
            auth: keys.auth.toString('base64url'),
          },
        },
        payload,
        vapid,
        urgency: 'high',
      });
      const message = decryptPush(Buffer.from(request.body), keys);
      expect(JSON.parse(message.plaintext.toString('utf8'))).toEqual(payload);
      expect(message.recordSize).toBe(4096);
      expect(message.senderKey[0]).toBe(0x04);
      expect(Buffer.from(request.body).includes(Buffer.from(payload.title))).toBe(false);
      expect(() => decryptPush(Buffer.from(request.body), newBrowserKeys())).toThrow();
    }
  });

  it('carries the headers a push service needs: the encoding, how long it may wait, its urgency and the signature', async () => {
    const { default: webPush } = await import('web-push');
    Object.assign(vapid, webPush.generateVAPIDKeys());
    const keys = newBrowserKeys();
    const subscription = {
      endpoint: endpointAt('a'),
      keys: { p256dh: keys.public.toString('base64url'), auth: keys.auth.toString('base64url') },
    };
    const high = buildPushRequest({ subscription, payload, vapid, urgency: 'high' });
    expect(high.url).toBe(subscription.endpoint);
    expect(high.headers['Content-Encoding']).toBe('aes128gcm');
    expect(high.headers['Content-Type']).toBe('application/octet-stream');
    expect(high.headers['TTL']).toBe('86400');
    expect(high.headers['Urgency']).toBe('high');
    // The body states its own length; the headers do not state it a second time.
    expect(Object.keys(high.headers).map((name) => name.toLowerCase())).not.toContain(
      'content-length',
    );
    checkVapid(high.headers['Authorization']!, subscription.endpoint, vapid.publicKey);
    expect(
      buildPushRequest({ subscription, payload, vapid, urgency: 'normal' }).headers['Urgency'],
    ).toBe('normal');
  });
});

describe('the push routes', () => {
  it('give the public key, made once and kept, and never the private half', async () => {
    const { started, send } = await world();
    const delivery = join(started.stateDir, 'delivery');
    expect(existsSync(join(delivery, 'vapid.json'))).toBe(false);
    const first = await send('GET', 'push/key');
    expect(first.status).toBe(200);
    expect(Object.keys(first.body)).toEqual(['publicKey']);
    expect(Buffer.from(first.body.publicKey, 'base64url')).toHaveLength(65);
    expect((await send('GET', 'push/key')).body).toEqual(first.body);
    const stored = JSON.parse(readFileSync(join(delivery, 'vapid.json'), 'utf8'));
    expect(stored.publicKey).toBe(first.body.publicKey);
    expect(Buffer.from(stored.privateKey, 'base64url')).toHaveLength(32);
    expect(JSON.stringify(first.body)).not.toContain(stored.privateKey);
    if (process.platform !== 'win32') {
      expect(statSync(join(delivery, 'vapid.json')).mode & 0o777).toBe(0o600);
      expect(statSync(delivery).mode & 0o777).toBe(0o700);
    }
    expect(readdirSync(delivery).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('keep the same key across a restart of the agent’s state, so a subscription keeps working', async () => {
    const { started, send } = await world();
    const { publicKey } = (await send('GET', 'push/key')).body;
    const stored = JSON.parse(
      readFileSync(join(started.stateDir, 'delivery', 'vapid.json'), 'utf8'),
    );
    const { createVapid } = await import('../push/vapid.js');
    const again = createVapid(join(started.stateDir, 'delivery')).keys();
    expect(again).toEqual({ publicKey, privateKey: stored.privateKey });
  });

  it('count the browsers subscribed and say nothing else about them', async () => {
    const { send, subscribe } = await world();
    expect(await send('GET', 'push')).toEqual({
      status: 200,
      body: { subscribed: 0, supported: true },
    });
    const keys = newBrowserKeys();
    const answer = await send('POST', 'push/subscribe', subscriptionOf(endpointAt('a'), keys));
    expect(answer).toEqual({ status: 200, body: { subscribed: 1, supported: true } });
    await subscribe('b');
    expect((await send('GET', 'push')).body).toEqual({ subscribed: 2, supported: true });
    // The same browser subscribing again is still one browser.
    await send('POST', 'push/subscribe', subscriptionOf(endpointAt('a'), keys));
    expect((await send('GET', 'push')).body.subscribed).toBe(2);
  });

  it('stop a browser by its address, and stopping one that is not kept is no error', async () => {
    const { send, subscribe } = await world();
    await subscribe('a');
    await subscribe('b');
    expect(await send('DELETE', 'push/subscribe', { endpoint: endpointAt('a') })).toEqual({
      status: 200,
      body: { subscribed: 1, supported: true },
    });
    expect(
      (await send('DELETE', 'push/subscribe', { endpoint: endpointAt('a') })).body.subscribed,
    ).toBe(1);
    expect((await send('DELETE', 'push/subscribe', { endpoint: endpointAt('zzz') })).status).toBe(
      200,
    );
  });

  it('refuse what is not a subscription, in plain words that repeat none of it', async () => {
    const { send } = await world();
    const keys = newBrowserKeys();
    const good = subscriptionOf(endpointAt('a'), keys);
    const refusals: [unknown, RegExp][] = [
      [undefined, /must be an object/u],
      [[good], /must be an object/u],
      [{ keys: good.keys }, /must be a web address/u],
      [{ ...good, endpoint: 7 }, /must be a web address/u],
      [{ ...good, endpoint: 'not an address' }, /not a valid web address/u],
      [{ ...good, endpoint: `http://${PUSH_HOST}/send/${TOKEN}` }, /must start with https:\/\//u],
      [
        { ...good, endpoint: `https://person:${TOKEN}@${PUSH_HOST}/send/x` },
        /must not hold a user name or password/u,
      ],
      [
        { ...good, endpoint: `https://${PUSH_HOST}/${'x'.repeat(2100)}` },
        /at most 2048 characters/u,
      ],
      [{ endpoint: good.endpoint }, /must carry its p256dh and auth keys/u],
      [{ ...good, keys: { auth: good.keys.auth } }, /p256dh key is not a valid public key/u],
      [
        { ...good, keys: { ...good.keys, p256dh: 'not base64url!' } },
        /p256dh key is not a valid public key/u,
      ],
      [
        { ...good, keys: { ...good.keys, p256dh: Buffer.alloc(64, 4).toString('base64url') } },
        /p256dh key is not a valid public key/u,
      ],
      // Right length and the right first byte, but not a point on the curve.
      [
        {
          ...good,
          keys: {
            ...good.keys,
            p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'),
          },
        },
        /p256dh key is not a valid public key/u,
      ],
      [{ ...good, keys: { p256dh: good.keys.p256dh } }, /auth secret must be 16 bytes/u],
      [
        { ...good, keys: { ...good.keys, auth: Buffer.alloc(15).toString('base64url') } },
        /auth secret must be 16 bytes/u,
      ],
      [
        { ...good, keys: { ...good.keys, auth: Buffer.alloc(17).toString('base64url') } },
        /auth secret must be 16 bytes/u,
      ],
    ];
    for (const [body, message] of refusals) {
      const refused = await send('POST', 'push/subscribe', body);
      expect(refused.status, JSON.stringify(body)?.slice(0, 80)).toBe(400);
      expect(refused.body.error, JSON.stringify(body)?.slice(0, 80)).toMatch(message);
      expect(JSON.stringify(refused.body)).not.toContain(TOKEN);
      expect(JSON.stringify(refused.body)).not.toContain(good.keys.p256dh);
      expect(JSON.stringify(refused.body)).not.toContain(good.keys.auth);
    }
    expect((await send('GET', 'push')).body.subscribed).toBe(0);
    expect((await send('DELETE', 'push/subscribe')).body.error).toMatch(/Name the push address/u);
    expect((await send('DELETE', 'push/subscribe', { endpoint: 'http://x.test/y' })).status).toBe(
      400,
    );
  });

  it('refuse a loopback, private or metadata destination, unless the owner named the host', async () => {
    const { send, resolves } = await world();
    const keys = newBrowserKeys();
    for (const endpoint of [
      `https://127.0.0.1:4443/send/${TOKEN}`,
      `https://localhost/send/${TOKEN}`,
      `https://[::1]/send/${TOKEN}`,
      `https://10.1.2.3/send/${TOKEN}`,
      `https://192.168.1.20/send/${TOKEN}`,
      `https://169.254.169.254/send/${TOKEN}`,
      `https://metadata.google.internal/send/${TOKEN}`,
      `https://printer.localhost/send/${TOKEN}`,
    ]) {
      const refused = await send('POST', 'push/subscribe', subscriptionOf(endpoint, keys));
      expect(refused.status, endpoint).toBe(400);
      expect(refused.body.error, endpoint).toMatch(/cannot be used: it is a loopback/u);
      expect(JSON.stringify(refused.body), endpoint).not.toContain(TOKEN);
    }
    // A public name that resolves to a private address is judged by where it goes.
    resolves.to = ['10.0.0.5'];
    const refused = await send('POST', 'push/subscribe', subscriptionOf(endpointAt('a'), keys));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe(
      `The push address (${PUSH_HOST}) cannot be used: it is a loopback, private or link-local address, which is reached only when the owner names its host`,
    );
    resolves.to = [];
    expect(
      (await send('POST', 'push/subscribe', subscriptionOf(endpointAt('a'), keys))).body.error,
    ).toMatch(/name does not resolve/u);
    expect((await send('GET', 'push')).body.subscribed).toBe(0);
  });

  it('accept a private destination only for the host the owner named', async () => {
    const { send, resolves } = await world({ allowedHosts: [PUSH_HOST] });
    resolves.to = ['10.0.0.5'];
    const keys = newBrowserKeys();
    expect(
      (await send('POST', 'push/subscribe', subscriptionOf(endpointAt('a'), keys))).status,
    ).toBe(200);
    // Naming one host names no other.
    const other = await send(
      'POST',
      'push/subscribe',
      subscriptionOf(`https://other.stand-in.test/send/${TOKEN}`, keys),
    );
    expect(other.status).toBe(400);
    expect(other.body.error).toMatch(/cannot be used: it is a loopback, private/u);
  });

  it('keep five browsers, a sixth taking the place of the oldest', async () => {
    const { started, send, push, subscribe } = await world();
    const keys: IBrowserKeys[] = [];
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) keys.push(await subscribe(name));
    expect((await send('GET', 'push')).body.subscribed).toBe(5);
    await askInChat(started, 'Sign-in', 'now');
    expect(push.received.map((request) => request.path).sort()).toEqual(
      ['b', 'c', 'd', 'e', 'f'].map(pathAt).sort(),
    );
  });

  it('answer only the person’s own browser: the cookie and the write header are both needed', async () => {
    const { send, started } = await world();
    const keys = newBrowserKeys();
    const body = subscriptionOf(endpointAt('a'), keys);
    const gated: [string, string, unknown][] = [
      ['GET', 'push', undefined],
      ['GET', 'push/key', undefined],
      ['POST', 'push/subscribe', body],
      ['DELETE', 'push/subscribe', { endpoint: body.endpoint }],
    ];
    for (const [method, path, payload] of gated) {
      expect(
        (await send(method, path, payload, { cookie: false })).status,
        `${method} ${path}`,
      ).toBe(403);
      if (method !== 'GET')
        expect(
          (await send(method, path, payload, { write: false })).status,
          `${method} ${path}`,
        ).toBe(403);
    }
    expect(existsSync(join(started.stateDir, 'delivery', 'vapid.json'))).toBe(false);
    expect((await send('GET', 'push')).body.subscribed).toBe(0);
  });

  it('do not answer other methods or other paths under push', async () => {
    const { send } = await world();
    for (const [method, path] of [
      ['PUT', 'push'],
      ['POST', 'push/key'],
      ['GET', 'push/subscribe'],
      ['GET', 'push/other'],
      ['GET', 'push/key/more'],
    ] as const)
      expect((await send(method, path, method === 'GET' ? undefined : {})).status, path).toBe(404);
  });
});

describe('a question the agent asks', () => {
  it('reaches the subscribed browser once, encrypted, signed as the agent, when it needs the person now', async () => {
    const { started, send, push, subscribe } = await world();
    const keys = await subscribe('a');
    const { publicKey } = (await send('GET', 'push/key')).body;
    await askInChat(started, 'New sign-in from Lagos', 'now');
    expect(push.received).toHaveLength(1);
    const [request] = push.received;
    expect(request!.method).toBe('POST');
    expect(request!.path).toBe(pathAt('a'));
    expect(request!.headers['content-encoding']).toBe('aes128gcm');
    expect(request!.headers['content-type']).toBe('application/octet-stream');
    expect(request!.headers['ttl']).toBe('86400');
    expect(request!.headers['urgency']).toBe('high');
    checkVapid(request!.headers['authorization'] as string, endpointAt('a'), publicKey);
    const message = opened(request!, keys);
    expect(Object.keys(message).sort()).toEqual(['tag', 'text', 'title', 'url']);
    expect(message['title']).toBe('New sign-in from Lagos');
    expect(message['text']).toBe(`New sign-in from Lagos: Was this you? ${POINTER}`);
    expect(message['url']).toBe(FEED_URL);
    expect(message['tag']).toMatch(/^question-/u);
    expect(await sent(started)).toBe(1);
    expect(await openQuestions(started)).toBe(1);
  });

  it('is shown on one line and within a bound, whatever the content it came from said', async () => {
    const { started, push, subscribe } = await world();
    const keys = await subscribe('a');
    // The longest title a case keeps, with a line break in it.
    await askInChat(started, `Line one\nline two ${'x'.repeat(100)}`, 'now');
    const message = opened(push.received[0]!, keys);
    expect(message['title']).toMatch(/^Line one line two x+\.\.\.$/u);
    expect([...message['title']!]).toHaveLength(100);
    expect(message['text']).not.toMatch(/[\r\n]/u);
    expect(message['url']).toBe(FEED_URL);
  });

  it('keeps the digest within a bound too, however many questions it names', async () => {
    const { started, push, subscribe } = await world();
    const keys = await subscribe('a');
    for (let index = 0; index < 8; index += 1)
      await askInChat(started, `Question ${index} ${'y'.repeat(100)}`, 'digest');
    clock.now = at(8, 0, 17);
    await started.capabilities.delivery.tick();
    const message = opened(push.received[0]!, keys);
    expect(message['text']).not.toMatch(/[\r\n]/u);
    expect([...message['text']!]).toHaveLength(500);
    expect(message['text']).toMatch(/^8 questions are waiting for you: - Question 0 y+/u);
    expect(message['text']).toMatch(/\.\.\.$/u);
  });

  it('gives each question a tag of its own, so none replaces another before it is seen', async () => {
    const { started, push, subscribe } = await world();
    const keys = await subscribe('a');
    await askInChat(started, 'First', 'now');
    await askInChat(started, 'Second', 'now');
    const tags = push.received.map((request) => opened(request, keys)['tag']);
    expect(new Set(tags).size).toBe(2);
  });

  it('does not reach it once the day’s limit is used, nor when it can wait, nor when it is for the feed', async () => {
    const { started, send, push, subscribe } = await world();
    await send('PUT', 'delivery', { dailyLimit: 1 });
    const keys = await subscribe('a');
    await askInChat(started, 'First', 'now');
    await askInChat(started, 'Second', 'now');
    await askInChat(started, 'Third', 'digest');
    await askInChat(started, 'Fourth', 'feed');
    expect(push.received.map((request) => opened(request, keys)['title'])).toEqual(['First']);
    expect(await sent(started)).toBe(1);
    expect(await openQuestions(started)).toBe(4);
  });

  it('does not reach it in quiet hours', async () => {
    const { started, push, subscribe } = await world();
    await subscribe('a');
    clock.now = at(23, 0);
    await askInChat(started, 'Late sign-in', 'now');
    expect(push.received).toEqual([]);
    expect(await sent(started)).toBe(0);
  });

  it('reaches it in the daily digest once, at normal urgency, with a tag that replaces the one before', async () => {
    const { started, push, subscribe } = await world();
    const keys = await subscribe('a');
    await askInChat(started, 'Alpha', 'digest');
    await askInChat(started, 'Bravo', 'digest');
    expect(push.received).toEqual([]);
    clock.now = at(8, 0, 17);
    await started.capabilities.delivery.tick();
    await started.capabilities.delivery.tick();
    expect(push.received).toHaveLength(1);
    expect(push.received[0]!.headers['urgency']).toBe('normal');
    expect(push.received[0]!.headers['ttl']).toBe('86400');
    const message = opened(push.received[0]!, keys);
    expect(message['title']).toBe('2 questions waiting for you');
    expect(message['text']).toBe(`2 questions are waiting for you: - Alpha - Bravo ${POINTER}`);
    expect(message['tag']).toBe('digest');
    expect(message['url']).toBe(FEED_URL);
  });

  it('reaches every browser subscribed, each with a message only its own keys open', async () => {
    const { started, push, subscribe } = await world();
    const first = await subscribe('a');
    const second = await subscribe('b');
    await askInChat(started, 'New sign-in from Lagos', 'now');
    expect(push.received).toHaveLength(2);
    const byPath = new Map(push.received.map((request) => [request.path, request]));
    expect(opened(byPath.get(pathAt('a'))!, first)['title']).toBe('New sign-in from Lagos');
    expect(opened(byPath.get(pathAt('b'))!, second)['title']).toBe('New sign-in from Lagos');
    expect(() => opened(byPath.get(pathAt('a'))!, second)).toThrow();
    // Two browsers took it and it is one push against the limit.
    expect(await sent(started)).toBe(1);
  });

  it('is not counted, and stays in the feed, when the push service answers with an error; it is not tried again and the browser stays subscribed', async () => {
    const { started, send, push, subscribe } = await world();
    await subscribe('a');
    push.answer(500);
    await askInChat(started, 'New sign-in from Lagos', 'now');
    expect(push.received).toHaveLength(1);
    expect(await sent(started)).toBe(0);
    expect(await openQuestions(started)).toBe(1);
    expect((await send('GET', 'push')).body.subscribed).toBe(1);
    // The limit is untouched: once the service is back, the next question is pushed.
    push.answer(201);
    await askInChat(started, 'Bill due', 'now');
    expect(push.received).toHaveLength(2);
    expect(await sent(started)).toBe(1);
  });

  it.each([404, 410])(
    'forgets a browser whose push service answers %i, and the push is not counted',
    async (status) => {
      const { started, send, push, subscribe } = await world();
      await subscribe('a');
      push.answer(status);
      await askInChat(started, 'New sign-in from Lagos', 'now');
      expect(push.received).toHaveLength(1);
      expect((await send('GET', 'push')).body.subscribed).toBe(0);
      expect(await sent(started)).toBe(0);
      expect(await openQuestions(started)).toBe(1);
      // Nothing is subscribed now, so the next question is not tried at all.
      await askInChat(started, 'Bill due', 'now');
      expect(push.received).toHaveLength(1);
    },
  );

  it('is counted when one browser took it, and only the browser that is gone is forgotten', async () => {
    const { started, send, push, subscribe } = await world();
    await subscribe('a');
    await subscribe('b');
    push.answer(410, { path: pathAt('a') });
    await askInChat(started, 'New sign-in from Lagos', 'now');
    expect(push.received).toHaveLength(2);
    expect(await sent(started)).toBe(1);
    expect((await send('GET', 'push')).body.subscribed).toBe(1);
    await askInChat(started, 'Bill due', 'now');
    expect(push.received.map((request) => request.path).slice(2)).toEqual([pathAt('b')]);
  });

  it('is not counted when the push service does not answer in time, and not tried again', async () => {
    const { started, send, push, subscribe } = await world();
    await subscribe('a');
    push.hang();
    await askInChat(started, 'New sign-in from Lagos', 'now');
    expect(push.received).toHaveLength(1);
    expect(await sent(started)).toBe(0);
    expect(await openQuestions(started)).toBe(1);
    expect((await send('GET', 'push')).body.subscribed).toBe(1);
  }, 30_000);

  it('never follows a redirect: what was sent goes to the address that was given and nowhere else', async () => {
    const { started, send, push, subscribe } = await world();
    await subscribe('a');
    for (const status of [301, 302, 307, 308]) {
      push.answer(status, { path: pathAt('a'), headers: { location: endpointAt('elsewhere') } });
      await askInChat(started, `Sign-in ${status}`, 'now');
    }
    expect(push.received.map((request) => request.path)).toEqual(Array(4).fill(pathAt('a')));
    expect(await sent(started)).toBe(0);
    expect((await send('GET', 'push')).body.subscribed).toBe(1);
  });

  it('is judged by the policy again when it is sent: a name that now resolves to a private address is refused', async () => {
    const { started, send, push, subscribe, resolves } = await world();
    await subscribe('a');
    resolves.to = ['127.0.0.1'];
    await askInChat(started, 'New sign-in from Lagos', 'now');
    expect(push.received).toEqual([]);
    expect(await sent(started)).toBe(0);
    expect(await openQuestions(started)).toBe(1);
    expect((await send('GET', 'push')).body.subscribed).toBe(1);
    resolves.to = ['203.0.113.10'];
    await askInChat(started, 'Bill due', 'now');
    expect(push.received).toHaveLength(1);
    expect(await sent(started)).toBe(1);
  });

  it('reaches nothing before a browser subscribes, and the limit is not used', async () => {
    const { started, push } = await world();
    await askInChat(started, 'New sign-in from Lagos', 'now');
    expect(push.received).toEqual([]);
    expect(await sent(started)).toBe(0);
    expect(await openQuestions(started)).toBe(1);
  });

  it('reaches nothing once the browser has stopped, though it reached it before', async () => {
    const { started, send, push, subscribe } = await world();
    await subscribe('a');
    await askInChat(started, 'First', 'now');
    await send('DELETE', 'push/subscribe', { endpoint: endpointAt('a') });
    await askInChat(started, 'Second', 'now');
    expect(push.received).toHaveLength(1);
    expect(await sent(started)).toBe(1);
  });

  it('is told by the browser and by the address alike, and the push counts once', async () => {
    const { started, send, push, hook, subscribe } = await world();
    await subscribe('a');
    await send('PUT', 'delivery/webhook', { url: `https://${HOOK_HOST}/topics/${TOKEN}` });
    await askInChat(started, 'Both places', 'now');
    expect(push.received).toHaveLength(1);
    expect(hook.received).toHaveLength(1);
    expect(await sent(started)).toBe(1);
  });

  it('still counts when only the address took it, and does not when neither did', async () => {
    const { started, send, push, hook, subscribe } = await world();
    await subscribe('a');
    await send('PUT', 'delivery/webhook', { url: `https://${HOOK_HOST}/topics/${TOKEN}` });
    push.answer(503);
    await askInChat(started, 'Only the address', 'now');
    expect(await sent(started)).toBe(1);
    hook.answer(503);
    await askInChat(started, 'Neither', 'now');
    expect(push.received).toHaveLength(2);
    expect(hook.received).toHaveLength(2);
    expect(await sent(started)).toBe(1);
  });

  it('is made anew if the signing key is made anew: the browsers bound to the old key are forgotten', async () => {
    const { started, send, subscribe } = await world();
    await subscribe('a');
    const { rmSync } = await import('node:fs');
    rmSync(join(started.stateDir, 'delivery', 'vapid.json'));
    // The running agent holds its pair; a restart reads the file, finds none and makes one.
    const { createVapid } = await import('../push/vapid.js');
    const { createPushSubscriptions } = await import('../push/subscriptions.js');
    const subscriptions = createPushSubscriptions({
      directory: join(started.stateDir, 'delivery'),
      admit: async () => undefined,
    });
    expect(subscriptions.count()).toBe(1);
    const fresh = createVapid(join(started.stateDir, 'delivery'), () =>
      subscriptions.clear(),
    ).keys();
    expect(subscriptions.count()).toBe(0);
    expect(fresh.publicKey).not.toBe((await send('GET', 'push/key')).body.publicKey);
  });

  it('refuses a key file that is not a key pair, and says which file, not what is in it', async () => {
    const { started } = await world();
    const { writeFileSync } = await import('node:fs');
    const { createVapid } = await import('../push/vapid.js');
    const directory = join(started.stateDir, 'delivery');
    const path = join(directory, 'vapid.json');
    // The running agent already holds its pair, so a new reader stands for a restart.
    const failureOf = (): string => {
      try {
        createVapid(directory).keys();
      } catch (failure) {
        return String(failure);
      }
      return '';
    };
    writeFileSync(path, `{"publicKey":"${TOKEN}","privateKey":"${TOKEN}"}`);
    expect(failureOf()).toContain(path);
    expect(failureOf()).toMatch(/cannot be used/u);
    expect(failureOf()).not.toContain(TOKEN);
    writeFileSync(path, 'not json');
    expect(failureOf()).toContain(path);
    expect(failureOf()).toMatch(/cannot be used/u);
  });
});

describe('a push address is the person’s alone', () => {
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

    const { started, send, push } = await world();
    const answers: unknown[] = [];
    const keep = async (reply: Promise<IReply>): Promise<void> =>
      void answers.push((await reply).body);
    const keys = newBrowserKeys();
    const subscription = subscriptionOf(endpointAt('a'), keys);
    await keep(
      send('POST', 'push/subscribe', { ...subscription, endpoint: `http://${PUSH_HOST}/${TOKEN}` }),
    );
    await keep(
      send('POST', 'push/subscribe', {
        ...subscription,
        endpoint: `https://person:${TOKEN}@${PUSH_HOST}/x`,
      }),
    );
    await keep(
      send('POST', 'push/subscribe', {
        ...subscription,
        endpoint: `https://127.0.0.1/send/${TOKEN}`,
      }),
    );
    await keep(send('POST', 'push/subscribe', subscription));
    await keep(send('GET', 'push'));
    await keep(send('GET', 'push/key'));
    await keep(send('GET', 'delivery'));
    await keep(send('GET', 'settings'));
    push.answer(500);
    await askInChat(started, 'New sign-in from Lagos', 'now');
    push.answer(302, { headers: { location: endpointAt('elsewhere') } });
    await askInChat(started, 'Bill due', 'now');
    push.answer(201);
    await askInChat(started, 'Parcel', 'now');
    await keep(send('GET', 'feed'));
    await keep(send('GET', 'cases'));
    await keep(send('GET', 'goals'));
    await keep(send('GET', 'notifications?after=0'));
    await keep(send('DELETE', 'push/subscribe', { endpoint: subscription.endpoint }));
    await keep(send('POST', 'push/subscribe', subscription));

    const vapid = JSON.parse(
      readFileSync(join(started.stateDir, 'delivery', 'vapid.json'), 'utf8'),
    ) as { privateKey: string };
    const secrets = [TOKEN, subscription.keys.p256dh, subscription.keys.auth, vapid.privateKey];
    for (const secret of secrets) {
      expect(JSON.stringify(answers), secret).not.toContain(secret);
      expect(written.join('\n'), secret).not.toContain(secret);
      // What the agent was told in the turns it took is no place for them either.
      expect(JSON.stringify(started.model.requests), secret).not.toContain(secret);
    }
    expect(JSON.stringify(started.model.requests)).not.toContain(PUSH_HOST);
    // Each is in the one file that keeps it and nowhere else on disk.
    const list = join('delivery', 'push-subscriptions.json');
    expect(filesHolding(started.stateDir, TOKEN)).toEqual([list]);
    expect(filesHolding(started.stateDir, PUSH_HOST)).toEqual([list]);
    expect(filesHolding(started.stateDir, subscription.keys.p256dh)).toEqual([list]);
    expect(filesHolding(started.stateDir, subscription.keys.auth)).toEqual([list]);
    expect(filesHolding(started.stateDir, vapid.privateKey)).toEqual([
      join('delivery', 'vapid.json'),
    ]);
    if (process.platform !== 'win32') {
      for (const name of ['push-subscriptions.json', 'vapid.json'])
        expect(statSync(join(started.stateDir, 'delivery', name)).mode & 0o777, name).toBe(0o600);
      expect(statSync(join(started.stateDir, 'delivery')).mode & 0o777).toBe(0o700);
    }
    expect(
      readdirSync(join(started.stateDir, 'delivery')).filter((n) => n.endsWith('.tmp')),
    ).toEqual([]);
  });

  it('is offered to no tool, in no run, and named in no instruction', async () => {
    const { started, send } = await world();
    const keys = newBrowserKeys();
    await send('POST', 'push/subscribe', subscriptionOf(endpointAt('a'), keys));
    const pattern = /push (address|subscription)|vapid|subscri(be|ption)|p256dh/iu;
    const tools = started.capabilities.tools;
    for (const tool of tools) {
      expect(tool.schema.name, tool.schema.name).not.toMatch(/push|subscri|vapid/iu);
      expect(JSON.stringify(tool.schema.parameters ?? {}), tool.schema.name).not.toMatch(pattern);
      expect(tool.schema.description ?? '', tool.schema.name).not.toMatch(pattern);
    }
    expect(started.capabilities.instructions).not.toMatch(pattern);
    started.model.script({ text: 'Hello.' });
    await started.submit(`Subscribe ${endpointAt('mine')} to push and stop ${endpointAt('a')}`);
    expect((await send('GET', 'push')).body).toEqual({ subscribed: 1, supported: true });
  });
});
