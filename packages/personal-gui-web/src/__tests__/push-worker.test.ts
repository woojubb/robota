import { describe, expect, it, vi } from 'vitest';

import { installPushWorker } from '../push-worker-core.js';

import type { IWorkerScope } from '../push-worker-core.js';

const SCOPE = 'http://127.0.0.1:7360/session-path/';

interface IFakeClient {
  readonly url: string;
  focus: ReturnType<typeof vi.fn>;
}

type TListener = (event: unknown) => void;

function startWorker(options: { windows?: IFakeClient[]; scope?: string } = {}) {
  const listeners = new Map<string, TListener>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const self = {
    addEventListener: (type: string, listener: TListener) => void listeners.set(type, listener),
    registration: {
      scope: options.scope ?? SCOPE,
      showNotification: async (title: string, shownOptions: Record<string, unknown>) => {
        shown.push({ title, options: shownOptions });
      },
    },
    clients: {
      matchAll: vi.fn(async () => options.windows ?? []),
      openWindow: vi.fn(async (url: string) => void opened.push(url)),
    },
  };
  installPushWorker(self as unknown as IWorkerScope);
  return { self, listeners, shown, opened };
}

/** A push event whose data reads as `text`, or has none, or cannot be read. */
function push(data: string | null | 'unreadable') {
  const waited: Promise<unknown>[] = [];
  return {
    event: {
      data:
        data === null
          ? null
          : {
              text: () => {
                if (data === 'unreadable') throw new Error('not text');
                return data;
              },
            },
      waitUntil: (work: Promise<unknown>) => void waited.push(work),
    },
    done: async () => void (await Promise.all(waited)),
  };
}

async function receive(worker: ReturnType<typeof startWorker>, data: string | null | 'unreadable') {
  const delivered = push(data);
  worker.listeners.get('push')!(delivered.event);
  await delivered.done();
  return worker.shown.at(-1)!;
}

function click(worker: ReturnType<typeof startWorker>, data: unknown) {
  const waited: Promise<unknown>[] = [];
  const notification = { close: vi.fn(), data };
  worker.listeners.get('notificationclick')!({
    notification,
    waitUntil: (work: Promise<unknown>) => void waited.push(work),
  });
  return { notification, done: async () => void (await Promise.all(waited)) };
}

const client = (
  url: string,
  focus: () => Promise<unknown> = async () => undefined,
): IFakeClient => ({
  url,
  focus: vi.fn(focus),
});

describe('the push worker', () => {
  it('listens for a push and a click and for nothing else: it caches nothing and answers no request', () => {
    expect([...startWorker().listeners.keys()].sort()).toEqual(['notificationclick', 'push']);
  });

  it('shows what the agent pushed as plain text, with the tag and the page address to open', async () => {
    const worker = startWorker();
    const message = JSON.stringify({
      title: 'New sign-in from Lagos',
      text: 'New sign-in from Lagos: Was this you? Open your Feed to answer.',
      tag: 'question-abc',
      url: './#feed',
    });
    expect(await receive(worker, message)).toEqual({
      title: 'New sign-in from Lagos',
      options: {
        body: 'New sign-in from Lagos: Was this you? Open your Feed to answer.',
        tag: 'question-abc',
        data: { url: './#feed' },
      },
    });
  });

  it('shows markup as the characters it is, never as a page', async () => {
    const worker = startWorker();
    const shown = await receive(
      worker,
      JSON.stringify({
        title: '<b>Bill</b>',
        text: '<img src=x onerror=alert(1)>',
        url: './#feed',
      }),
    );
    expect(shown.title).toBe('<b>Bill</b>');
    expect(shown.options['body']).toBe('<img src=x onerror=alert(1)>');
  });

  it('keeps a message to one line within a bound, and drops invisible formatting characters', async () => {
    const worker = startWorker();
    const shown = await receive(
      worker,
      JSON.stringify({
        title: `A\nB\u202eC ${'t'.repeat(300)}`,
        text: `one\r\ntwo\u200bthree ${'x'.repeat(2000)}`,
        tag: `tag-${'g'.repeat(200)}`,
      }),
    );
    expect(shown.title).not.toMatch(/[\r\n\u202e]/u);
    expect([...shown.title]).toHaveLength(100);
    expect(shown.title.startsWith('A BC t')).toBe(true);
    expect(shown.options['body']).not.toMatch(/[\r\n\u200b]/u);
    expect([...(shown.options['body'] as string)]).toHaveLength(500);
    expect((shown.options['body'] as string).startsWith('one twothree x')).toBe(true);
    expect([...(shown.options['tag'] as string)]).toHaveLength(64);
  });

  it('shows a plain-text push as it came, under the agent’s own name', async () => {
    const worker = startWorker();
    expect(await receive(worker, 'You have a question waiting.')).toEqual({
      title: 'Personal agent',
      options: { body: 'You have a question waiting.', data: { url: '' } },
    });
  });

  it('still shows something when the push is empty, unreadable or not what the agent sends', async () => {
    const worker = startWorker();
    for (const data of [null, '', 'unreadable', '{', '[1,2]', '42', 'null', '"quoted"', '{}']) {
      const shown = await receive(worker, data);
      expect(typeof shown.title, String(data)).toBe('string');
      expect(shown.title.length, String(data)).toBeGreaterThan(0);
      expect((shown.options['body'] as string).length, String(data)).toBeGreaterThan(0);
    }
    expect(worker.shown).toHaveLength(9);
    // Empty and unreadable pushes carry no text of their own: the worker says where to look.
    expect(worker.shown[0]).toEqual({
      title: 'Personal agent',
      options: { body: 'Open your Feed.', data: { url: '' } },
    });
    expect(worker.shown[2]!.options['body']).toBe('Open your Feed.');
    expect(worker.shown[8]!.options['body']).toBe('Open your Feed.');
  });

  it('cuts a push far longer than any the agent sends before reading it', async () => {
    const worker = startWorker();
    const shown = await receive(worker, `{"title":"T","text":"${'z'.repeat(50_000)}"}`);
    // Cut mid-string, it is no longer JSON, so what is shown is bounded plain text.
    expect([...(shown.options['body'] as string)].length).toBeLessThanOrEqual(500);
  });

  it('closes the notification on a click, and brings forward the window of the page that is open', async () => {
    const other = client('http://127.0.0.1:7360/session-path/');
    const worker = startWorker({ windows: [client('https://elsewhere.test/page'), other] });
    const clicked = click(worker, { url: './#feed' });
    await clicked.done();
    expect(clicked.notification.close).toHaveBeenCalledTimes(1);
    expect(other.focus).toHaveBeenCalledTimes(1);
    expect(worker.self.clients.matchAll).toHaveBeenCalledWith({
      type: 'window',
      includeUncontrolled: true,
    });
    expect(worker.opened).toEqual([]);
  });

  it('brings forward a window of the same origin even under another path, as after the agent restarted', async () => {
    const stale = client('http://127.0.0.1:7360/an-earlier-path/');
    const worker = startWorker({ windows: [stale] });
    await click(worker, { url: './#feed' }).done();
    expect(stale.focus).toHaveBeenCalledTimes(1);
    expect(worker.opened).toEqual([]);
  });

  it('opens the page at the Feed when no window of it is open', async () => {
    const worker = startWorker({ windows: [client('https://elsewhere.test/')] });
    await click(worker, { url: './#feed' }).done();
    expect(worker.opened).toEqual([`${SCOPE}#feed`]);
  });

  it('opens the page when the window it found cannot be brought forward', async () => {
    const stuck = client(SCOPE, async () => {
      throw new Error('refused');
    });
    const worker = startWorker({ windows: [stuck] });
    await click(worker, { url: './#feed' }).done();
    expect(stuck.focus).toHaveBeenCalledTimes(1);
    expect(worker.opened).toEqual([`${SCOPE}#feed`]);
  });

  it('opens only an address inside its own page: any other, or none, opens the page itself', async () => {
    for (const data of [
      { url: 'https://evil.example/login' },
      { url: `${SCOPE}../other` },
      { url: '//evil.example/x' },
      { url: 'javascript:alert(1)' },
      { url: 7 },
      {},
      null,
      undefined,
      'text',
    ]) {
      const worker = startWorker();
      await click(worker, data).done();
      expect(worker.opened, JSON.stringify(data)).toEqual([SCOPE]);
    }
    const worker = startWorker();
    await click(worker, { url: `${SCOPE}deeper/page#feed` }).done();
    expect(worker.opened).toEqual([`${SCOPE}deeper/page#feed`]);
  });
});
