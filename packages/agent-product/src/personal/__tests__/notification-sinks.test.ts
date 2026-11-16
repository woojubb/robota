/**
 * Two more places a question can reach the person: an address of their own, and a page they have open.
 * The address is kept like a credential and is only ever the destination of their notifications; the page
 * only counts as a place to be told while it is polling.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BROWSER_LISTENING_MS,
  BROWSER_OUTBOX_CAPACITY,
  BrowserOutbox,
  CaseBook,
  DeliveryRefusedError,
  GoalBook,
  NotificationAddress,
  QuestionDelivery,
  createFileWebhookStore,
  createMemoryCaseStore,
  createMemoryDeliveryStore,
  createMemoryGoalStore,
  createMemoryWebhookStore,
  webhookMessage,
} from '../index.js';

import type {
  IDeliverySettings,
  IDeliveryState,
  IWebhookRequest,
  IWebhookTransport,
  TCaseUrgency,
  TWebhookAnswer,
} from '../index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const directory = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'notification-address-'));
  dirs.push(dir);
  return dir;
};

/** The part of the address that stands for a token; built from pieces so no scan takes it for one. */
const TOKEN = ['tok', 'en-', 'Qx7', 'kd2', 'Lm9'].join('');
const ADDRESS = `https://push.example.test/topics/${TOKEN}?auth=${TOKEN}`;
const POINTER = 'Open your Feed to answer.';

interface IFakeTransport extends IWebhookTransport {
  readonly posted: IWebhookRequest[];
  readonly admitted: URL[];
}

function transport(
  behaviour: {
    answer?: () => TWebhookAnswer | Promise<TWebhookAnswer>;
    admit?: (url: URL) => string | undefined;
  } = {},
): IFakeTransport {
  const posted: IWebhookRequest[] = [];
  const admitted: URL[] = [];
  return {
    posted,
    admitted,
    admit: async (url) => {
      admitted.push(url);
      return behaviour.admit?.(url);
    },
    post: async (request) => {
      posted.push(request);
      return behaviour.answer === undefined ? { status: 200 } : behaviour.answer();
    },
  };
}

const address = (
  fake: IFakeTransport = transport(),
  initial?: Parameters<typeof createMemoryWebhookStore>[0],
) => new NotificationAddress({ store: createMemoryWebhookStore(initial), transport: fake });

describe('the notification address a person gives', () => {
  it('is kept as an https address with a token in it, and shown only as a host and a format', async () => {
    const book = address();
    expect(await book.view()).toEqual({ configured: false, format: 'plain' });
    const saved = await book.set({ url: ADDRESS });
    expect(saved).toEqual({ configured: true, host: 'push.example.test', format: 'plain' });
    expect(await book.view()).toEqual(saved);
    expect(JSON.stringify(saved)).not.toContain(TOKEN);
    expect((await book.set({ url: ADDRESS, format: 'json' })).format).toBe('json');
    // A host with a port keeps it, so the person can tell two servers apart.
    expect((await book.set({ url: 'https://hooks.example.test:8443/x' })).host).toBe(
      'hooks.example.test:8443',
    );
  });

  it.each<[string, unknown, RegExp]>([
    ['nothing', {}, /must be a web address/u],
    ['a number', { url: 5 }, /must be a web address/u],
    ['blank', { url: '   ' }, /must be a web address/u],
    ['not an address', { url: 'push me' }, /not a valid web address/u],
    ['plain http', { url: `http://push.example.test/${TOKEN}` }, /must start with https:\/\//u],
    ['another scheme', { url: `ftp://push.example.test/${TOKEN}` }, /must start with https:\/\//u],
    [
      'a user name and password',
      { url: `https://person:${TOKEN}@push.example.test/x` },
      /must not hold a user name or password/u,
    ],
    ['a user name only', { url: 'https://person@push.example.test/x' }, /user name or password/u],
    ['too long', { url: `https://push.example.test/${'a'.repeat(2100)}` }, /at most 2048/u],
    ['an unknown format', { url: ADDRESS, format: 'xml' }, /format must be one of plain, json/u],
    ['an unknown setting', { url: ADDRESS, secret: 'x' }, /no setting named secret/u],
  ])(
    'refuses %s in plain words that never repeat what was typed',
    async (_what, change, message) => {
      const book = address();
      const refused = await book.set(change).then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(refused).toBeInstanceOf(DeliveryRefusedError);
      expect((refused as Error).message).toMatch(message);
      expect((refused as Error).message).not.toContain(TOKEN);
      expect(await book.view()).toEqual({ configured: false, format: 'plain' });
    },
  );

  it('refuses a change that is not an object', async () => {
    await expect(address().set([ADDRESS])).rejects.toThrow(/must be an object/u);
    await expect(address().set(ADDRESS)).rejects.toThrow(/must be an object/u);
  });

  it('is refused when the outbound-request policy does not allow the destination, naming the host and not the address', async () => {
    const fake = transport({ admit: () => 'it is a private address' });
    const book = address(fake);
    const refused = await book.set({ url: ADDRESS }).then(
      () => undefined,
      (failure: unknown) => failure as Error,
    );
    expect(refused?.message).toBe(
      'The notification address (push.example.test) cannot be used: it is a private address',
    );
    expect(refused?.message).not.toContain(TOKEN);
    expect(fake.admitted.map((url) => url.host)).toEqual(['push.example.test']);
    expect(await book.view()).toEqual({ configured: false, format: 'plain' });
  });

  it('keeps the earlier address when a new one is refused, and forgets it on request', async () => {
    const book = address(
      transport({ admit: (url) => (url.host === 'bad.example.test' ? 'no' : undefined) }),
    );
    await book.set({ url: ADDRESS, format: 'json' });
    await expect(book.set({ url: 'https://bad.example.test/x' })).rejects.toThrow(
      /cannot be used/u,
    );
    expect(await book.view()).toEqual({
      configured: true,
      host: 'push.example.test',
      format: 'json',
    });
    expect(await book.clear()).toEqual({ configured: false, format: 'plain' });
    expect(await book.configured()).toBe(false);
  });
});

describe('where the address is kept', () => {
  it('is one owner-only file in an owner-only directory, written whole, holding the address nowhere else', async () => {
    const dir = join(directory(), 'delivery');
    const store = createFileWebhookStore(dir);
    const book = new NotificationAddress({ store, transport: transport() });
    await book.set({ url: ADDRESS, format: 'json' });
    expect(readdirSync(dir)).toEqual(['webhook.json']);
    expect(JSON.parse(readFileSync(join(dir, 'webhook.json'), 'utf8'))).toEqual({
      url: ADDRESS,
      format: 'json',
    });
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'webhook.json')).mode & 0o777).toBe(0o600);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
    // Another run finds it again.
    const again = new NotificationAddress({
      store: createFileWebhookStore(dir),
      transport: transport(),
    });
    expect(await again.view()).toEqual({
      configured: true,
      host: 'push.example.test',
      format: 'json',
    });
    await again.clear();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('is no address when the file is not one, so nothing is sent', async () => {
    const dir = directory();
    const fake = transport();
    const book = new NotificationAddress({ store: createFileWebhookStore(dir), transport: fake });
    for (const content of [
      'not json',
      '{"url":"nonsense","format":"plain"}',
      '{"url":"https://a.test/x","format":"yaml"}',
      '[]',
    ]) {
      writeFileSync(join(dir, 'webhook.json'), content);
      expect(await book.view()).toEqual({ configured: false, format: 'plain' });
      await expect(book.test()).rejects.toThrow(/No notification address is set/u);
    }
    expect(fake.posted).toEqual([]);
  });
});

describe('how a message is written to the address', () => {
  const message = {
    kind: 'question' as const,
    title: 'New sign-in to your account',
    text: `New sign-in to your account: Was this you?\n${POINTER}`,
  };

  it('plain: the text is the body and a short single-lined title is a header', () => {
    expect(webhookMessage(message, 'plain')).toEqual({
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        title: 'New sign-in to your account',
      },
      body: message.text,
    });
  });

  it('plain: the title is printable ASCII on one line whatever the title holds, so no header is refused', () => {
    const odd = {
      ...message,
      title: `Sign-in\nfrom Café \u{1F514} 中文\t‮${'long '.repeat(40)}`,
    };
    const { headers } = webhookMessage(odd, 'plain');
    expect(headers['title']).toMatch(/^[\x20-\x7e]+$/u);
    expect(headers['title']!.startsWith('Sign-in from Cafe ? ??')).toBe(true);
    expect(headers['title']!.length).toBeLessThanOrEqual(100);
    expect(headers['title']!.endsWith('...')).toBe(true);
    // The carrier takes it: a header with a character beyond latin-1 would throw here.
    expect(() => new Headers(headers)).not.toThrow();
    expect(webhookMessage({ ...message, title: '\u{1F514}中' }, 'plain').headers['title']).toBe(
      '??',
    );
    expect(webhookMessage({ ...message, title: ' \n ' }, 'plain').headers['title']).toBe(
      'Personal agent',
    );
  });

  it('json: an object with the text and the title, as they are', () => {
    const titled = { ...message, title: 'Café \u{1F514}' };
    const { headers, body } = webhookMessage(titled, 'json');
    expect(headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(body)).toEqual({ text: message.text, title: 'Café \u{1F514}' });
  });

  it('is bounded in size, in both forms', () => {
    const long = { ...message, text: 'x'.repeat(20_000) };
    expect(webhookMessage(long, 'plain').body.length).toBe(4000);
    expect(webhookMessage(long, 'plain').body.endsWith('...')).toBe(true);
    expect(JSON.parse(webhookMessage(long, 'json').body).text.length).toBe(4000);
  });
});

describe('sending to the address', () => {
  const question = {
    kind: 'question' as const,
    title: 'Bill due',
    text: `Bill due: Paid?\n${POINTER}`,
  };

  it('posts once to the address, as set, and takes any 2xx answer as taken', async () => {
    for (const status of [200, 201, 204, 299]) {
      const fake = transport({ answer: () => ({ status }) });
      const book = address(fake);
      await book.set({ url: ADDRESS });
      await book.sink.deliver(question);
      expect(fake.posted).toEqual([
        {
          url: ADDRESS,
          headers: { 'content-type': 'text/plain; charset=utf-8', title: 'Bill due' },
          body: question.text,
          timeoutMs: 10_000,
        },
      ]);
    }
  });

  it.each([199, 300, 301, 302, 307, 400, 401, 404, 429, 500, 503])(
    'is not taken when the address answers %i, and the words name the host and the status only',
    async (status) => {
      const fake = transport({ answer: () => ({ status }) });
      const book = address(fake);
      await book.set({ url: ADDRESS });
      const failure = await book.sink.deliver(question).then(
        () => undefined,
        (caught: unknown) => caught as Error,
      );
      expect(failure).toBeInstanceOf(DeliveryRefusedError);
      expect(failure?.message).toBe(
        `The notification address (push.example.test) answered with status ${status}`,
      );
      expect(fake.posted).toHaveLength(1);
    },
  );

  it('is not taken when the request fails, and the words never carry what the failure says', async () => {
    const fake = transport({
      answer: () => {
        throw new Error(`connect ECONNREFUSED ${ADDRESS}`);
      },
    });
    const book = address(fake);
    await book.set({ url: ADDRESS });
    const failure = await book.sink.deliver(question).then(
      () => undefined,
      (caught: unknown) => caught as Error,
    );
    expect(failure?.message).toBe(
      'The notification address (push.example.test) could not be reached or did not answer in time',
    );
    expect(failure?.message).not.toContain(TOKEN);
    expect(fake.posted).toHaveLength(1);
  });

  it('is not taken when the policy refuses the destination at the time of sending, though it allowed it when saved', async () => {
    let allowed = true;
    const fake = transport({
      answer: () => (allowed ? { status: 200 } : { refused: 'it is a private address' }),
    });
    const book = address(fake);
    await book.set({ url: ADDRESS });
    await book.sink.deliver(question);
    allowed = false;
    await expect(book.sink.deliver(question)).rejects.toThrow(
      'The notification address (push.example.test) cannot be used: it is a private address',
    );
  });

  it('is not taken when no address is set', async () => {
    const fake = transport();
    await expect(address(fake).sink.deliver(question)).rejects.toThrow(
      /No notification address is set/u,
    );
    expect(fake.posted).toEqual([]);
  });

  it('sends the fixed test message through its own sink, in the format chosen', async () => {
    const fake = transport();
    const book = address(fake);
    await book.set({ url: ADDRESS, format: 'json' });
    await book.test();
    expect(fake.posted).toHaveLength(1);
    expect(JSON.parse(fake.posted[0]!.body)).toEqual({
      text: 'Test from your agent',
      title: 'Test',
    });
    await book.set({ url: ADDRESS });
    await book.test();
    expect(fake.posted[1]).toEqual(expect.objectContaining({ body: 'Test from your agent' }));
    expect(fake.posted[1]!.headers['title']).toBe('Test');
  });

  it('says in words that name no address when the test is not taken', async () => {
    const book = address(transport({ answer: () => ({ status: 404 }) }));
    await book.set({ url: ADDRESS });
    await expect(book.test()).rejects.toThrow(
      'The notification address (push.example.test) answered with status 404',
    );
  });
});

describe('the browser outbox', () => {
  const message = {
    kind: 'question' as const,
    title: 'Bill due',
    text: `Bill due: Paid?\n${POINTER}`,
  };
  const clock = { at: 1_700_000_000_000 };
  const outbox = (options: ConstructorParameters<typeof BrowserOutbox>[0] = {}) =>
    new BrowserOutbox({ now: () => clock.at, ...options });
  const reset = (): void => {
    clock.at = 1_700_000_000_000;
  };

  it('takes nothing while no page has polled, and takes it once one has', async () => {
    reset();
    const box = outbox();
    expect(box.listening()).toBe(false);
    await expect(box.deliver(message)).rejects.toThrow(/No page is open/u);
    expect(box.poll()).toEqual({ messages: [], latest: 0 });
    expect(box.listening()).toBe(true);
    await box.deliver(message);
    expect(box.poll(0)).toEqual({
      messages: [
        {
          id: 1,
          at: new Date(clock.at).toISOString(),
          kind: 'question',
          title: 'Bill due',
          text: message.text,
        },
      ],
      latest: 1,
    });
  });

  it('counts a page as open for ninety seconds after its last poll, and not a moment longer', async () => {
    reset();
    const box = outbox();
    box.poll();
    clock.at += BROWSER_LISTENING_MS;
    expect(BROWSER_LISTENING_MS).toBe(90_000);
    await box.deliver(message);
    clock.at += 1;
    await expect(box.deliver(message)).rejects.toThrow(/No page is open/u);
    // Nothing was kept for the refused one.
    expect(box.poll(0).messages.map((kept) => kept.id)).toEqual([1]);
    clock.at += 5_000;
    await box.deliver(message);
    expect(box.poll(0).latest).toBe(2);
  });

  it('gives each message the next id, and a page asks for what came after the last one it saw', async () => {
    reset();
    const box = outbox();
    box.poll();
    for (const title of ['One', 'Two', 'Three']) await box.deliver({ ...message, title });
    expect(box.poll(0).messages.map((kept) => [kept.id, kept.title])).toEqual([
      [1, 'One'],
      [2, 'Two'],
      [3, 'Three'],
    ]);
    expect(box.poll(1).messages.map((kept) => kept.id)).toEqual([2, 3]);
    expect(box.poll(3)).toEqual({ messages: [], latest: 3 });
    // A page with no cursor yet starts from now and is handed none of what came before it.
    expect(box.poll()).toEqual({ messages: [], latest: 3 });
  });

  it('keeps the last twenty only', async () => {
    reset();
    const box = outbox();
    box.poll();
    expect(BROWSER_OUTBOX_CAPACITY).toBe(20);
    for (let index = 1; index <= 25; index += 1)
      await box.deliver({ ...message, title: `M${index}` });
    const kept = box.poll(0).messages;
    expect(kept).toHaveLength(20);
    expect(kept[0]!.id).toBe(6);
    expect(kept.at(-1)!.id).toBe(25);
    expect(box.poll(23).messages.map((each) => each.id)).toEqual([24, 25]);
  });

  it('hands a page that remembers a later message than any here, as after a restart, everything it has', async () => {
    reset();
    const box = outbox();
    box.poll();
    await box.deliver(message);
    expect(box.poll(57).messages.map((kept) => kept.id)).toEqual([1]);
  });
});

/** A question asked on a case, and delivery has dealt with it. */
function deliveryWorld(
  sinks: ConstructorParameters<typeof QuestionDelivery>[0]['sinks'],
  settings?: IDeliverySettings,
) {
  const clock = { now: new Date(2026, 10, 16, 10, 0) };
  const goals = new GoalBook({ store: createMemoryGoalStore() });
  const delivery = new QuestionDelivery({
    settings: createMemoryDeliveryStore<IDeliverySettings>(settings),
    state: createMemoryDeliveryStore<IDeliveryState>(),
    sinks,
    feed: goals,
    now: () => clock.now,
  });
  const book = new CaseBook({
    store: createMemoryCaseStore(),
    feed: goals,
    onAsked: (event) => delivery.onAsked(event),
  });
  let sequence = 0;
  return {
    delivery,
    clock,
    ask: async (urgency: TCaseUrgency, title = 'New sign-in to your account') => {
      sequence += 1;
      const { case: opened } = await book.open({
        title,
        noticed: 'A mail says a new sign-in happened.',
        source: `mail:${sequence}`,
      });
      await book.ask(opened.id, {
        question: 'Did you sign in just now?',
        options: ['Yes, it was me', 'No'],
        urgency,
      });
      await delivery.idle();
    },
  };
}

describe('the address and the page as places a question is delivered to', () => {
  it('reaches the address once for a `now` question, counts it, and stops at the limit', async () => {
    const fake = transport();
    const book = address(fake);
    await book.set({ url: ADDRESS });
    const { ask, delivery } = deliveryWorld(async () => [book.sink], {
      dailyLimit: 1,
      quietHours: { enabled: false, from: '22:00', to: '08:00' },
      digest: { enabled: true, at: '08:00' },
    });
    await ask('now', 'Sign-in from Lagos');
    await ask('now', 'Bill due tomorrow');
    expect(fake.posted.map((request) => request.headers['title'])).toEqual(['Sign-in from Lagos']);
    expect(fake.posted[0]!.body).toBe(`Sign-in from Lagos: Did you sign in just now?\n${POINTER}`);
    expect(await delivery.status()).toEqual(
      expect.objectContaining({ today: { sent: 1, limit: 1 }, waitingInDigest: 1 }),
    );
  });

  it('is offered a message only while an address is set', async () => {
    const fake = transport();
    const book = address(fake);
    const { ask, delivery } = deliveryWorld(async () =>
      (await book.configured()) ? [book.sink] : [],
    );
    await ask('now', 'Before the address');
    expect(fake.posted).toEqual([]);
    expect((await delivery.status()).today.sent).toBe(0);
    await book.set({ url: ADDRESS });
    await ask('now', 'With the address');
    expect(fake.posted).toHaveLength(1);
    await book.clear();
    await ask('now', 'After the address');
    expect(fake.posted).toHaveLength(1);
    expect((await delivery.status()).today.sent).toBe(1);
  });

  it('is not counted, not retried and leaves the question in the feed when the address does not take it', async () => {
    const fake = transport({ answer: () => ({ status: 500 }) });
    const book = address(fake);
    await book.set({ url: ADDRESS });
    const { ask, delivery } = deliveryWorld(async () => [book.sink]);
    await ask('now');
    expect(fake.posted).toHaveLength(1);
    expect((await delivery.status()).today.sent).toBe(0);
  });

  it('is counted once when the address and the page both take it, and when either alone does', async () => {
    const fake = transport();
    const book = address(fake);
    await book.set({ url: ADDRESS });
    const page = new BrowserOutbox();
    const { ask, delivery } = deliveryWorld(async () => [page, book.sink]);
    await ask('now', 'Nobody looking');
    expect(fake.posted).toHaveLength(1);
    expect(page.poll(0).messages).toEqual([]);
    expect((await delivery.status()).today.sent).toBe(1);
    await ask('now', 'Both');
    expect(fake.posted).toHaveLength(2);
    expect(page.poll(0).messages.map((kept) => kept.title)).toEqual(['Both']);
    expect((await delivery.status()).today.sent).toBe(2);
  });

  it('does not count a push when only a page that is not open could have taken it', async () => {
    const page = new BrowserOutbox();
    const { ask, delivery } = deliveryWorld([page]);
    await ask('now');
    expect((await delivery.status()).today.sent).toBe(0);
    page.poll();
    await ask('now', 'Someone is looking');
    expect((await delivery.status()).today.sent).toBe(1);
    expect(page.poll(0).messages.map((kept) => kept.title)).toEqual(['Someone is looking']);
  });

  it('sends the digest to the address and the page too, once', async () => {
    const fake = transport();
    const book = address(fake);
    await book.set({ url: ADDRESS });
    const page = new BrowserOutbox();
    page.poll();
    const { ask, delivery, clock } = deliveryWorld(async () => [page, book.sink]);
    await ask('digest', 'Alpha');
    await ask('digest', 'Bravo');
    expect(fake.posted).toEqual([]);
    clock.now = new Date(2026, 10, 17, 8, 0);
    page.poll();
    await delivery.tick();
    await delivery.tick();
    expect(fake.posted).toHaveLength(1);
    expect(fake.posted[0]!.headers['title']).toBe('2 questions waiting for you');
    expect(fake.posted[0]!.body).toBe(
      `2 questions are waiting for you:\n- Alpha\n- Bravo\n${POINTER}`,
    );
    expect(page.poll(0).messages.map((kept) => [kept.kind, kept.title])).toEqual([
      ['digest', '2 questions waiting for you'],
    ]);
  });

  it('pushes nowhere when the list of sinks cannot be read, and the ask still goes through', async () => {
    const { ask, delivery } = deliveryWorld(async () => {
      throw new Error('cannot read');
    });
    await ask('now');
    expect((await delivery.status()).today.sent).toBe(0);
  });
});
