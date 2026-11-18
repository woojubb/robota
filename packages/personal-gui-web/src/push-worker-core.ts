/**
 * The personal agent's push worker: it turns a message the agent pushed into a notification while the
 * page is closed, and brings the page forward when the person clicks it. It caches nothing and answers no
 * request, so it listens for these two events only.
 *
 * Its registration has a stable scope separate from the page's per-launch path. A click can return to
 * an authenticated page or open the access-code page, even when the old page path no longer exists.
 * What it shows is plain text: a notification body is never markup.
 *
 * The handlers are installed on a scope given to them, so a test can stand in for the worker's global.
 */

/** The part of a push event this worker reads. */
export interface IPushEvent {
  readonly data: { text(): string } | null;
  waitUntil(work: Promise<unknown>): void;
}

/** The part of a notification click this worker reads. */
export interface IClickEvent {
  readonly notification: { close(): void; readonly data: unknown };
  waitUntil(work: Promise<unknown>): void;
}

export interface IWindowClient {
  readonly url: string;
  focus(): Promise<unknown>;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

/**
 * What the worker uses of its global scope. Declared here because the page's own types describe a window,
 * and the worker's scope is not one.
 */
export interface IWorkerScope {
  fetch(url: string, init: RequestInit): Promise<{ readonly ok: boolean }>;
  readonly registration: {
    readonly scope: string;
    showNotification(
      title: string,
      options: { body: string; tag?: string; data: { url: string } },
    ): Promise<void>;
  };
  readonly clients: {
    matchAll(options: {
      type: 'window';
      includeUncontrolled: boolean;
    }): Promise<readonly IWindowClient[]>;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(type: 'push', listener: (event: IPushEvent) => void): void;
  addEventListener(type: 'notificationclick', listener: (event: IClickEvent) => void): void;
}

const TITLE_LIMIT = 100;
const TEXT_LIMIT = 500;
const TAG_LIMIT = 64;
/** A message is a few hundred bytes; anything far longer is not one, and is cut before it is read. */
const RAW_LIMIT = 4000;
const FALLBACK_TITLE = 'Personal agent';
const FALLBACK_TEXT = 'Open your Feed.';
const PAGE_CHECK_TIMEOUT_MS = 1_000;
const PAGE_ACK_TIMEOUT_MS = 500;
const PAGE_FOCUS_TIMEOUT_MS = 1_000;

interface IShown {
  readonly title: string;
  readonly text: string;
  readonly tag: string;
  readonly url: string;
}

/** One line of plain text within a bound: no line breaks, no control or invisible formatting characters. */
function oneLine(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  const line = value
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
  const points = Array.from(line);
  return points.length <= limit
    ? line
    : `${points
        .slice(0, limit - 3)
        .join('')
        .trimEnd()}...`;
}

/** What a push carries, read defensively: JSON as the agent sends it, else the text as it came, else nothing. */
function readPush(event: IPushEvent): IShown {
  let raw = '';
  try {
    raw = event.data === null ? '' : event.data.text();
  } catch {
    // allow-fallback: a push that cannot be read as text is shown as one with nothing in it.
    raw = '';
  }
  raw = raw.slice(0, RAW_LIMIT);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // allow-fallback: what is not JSON is shown as the plain text it is.
    parsed = undefined;
  }
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const fields = parsed as Record<string, unknown>;
    const title = oneLine(fields['title'], TITLE_LIMIT);
    const text = oneLine(fields['text'], TEXT_LIMIT);
    return {
      title: title || FALLBACK_TITLE,
      text: title || text ? text : FALLBACK_TEXT,
      tag: oneLine(fields['tag'], TAG_LIMIT),
      url: typeof fields['url'] === 'string' ? fields['url'] : '',
    };
  }
  return {
    title: FALLBACK_TITLE,
    text: oneLine(raw, TEXT_LIMIT) || FALLBACK_TEXT,
    tag: '',
    url: '',
  };
}

/** A current page is a session path that still accepts this browser's cookie. */
async function isCurrentPage(
  scope: IWorkerScope,
  client: IWindowClient,
  origin: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const address = new URL(client.url);
    if (address.origin !== origin || !/^\/[A-Za-z0-9_-]{32}\/$/u.test(address.pathname))
      return false;
    return (
      await scope.fetch(`${origin}${address.pathname}`, {
        method: 'HEAD',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        signal,
      })
    ).ok;
  } catch {
    // allow-fallback: a page that cannot be checked is not a current session.
    return false;
  }
}

/** Check open pages concurrently and give up before the browser's click deadline. */
async function currentPage(
  scope: IWorkerScope,
  windows: readonly IWindowClient[],
  origin: string,
): Promise<IWindowClient | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.any(
        windows.map(async (client) => {
          if (await isCurrentPage(scope, client, origin, controller.signal)) return client;
          throw new Error('Not a current page');
        }),
      ).catch(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), PAGE_CHECK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** A loading page may not yet have a listener; only its acknowledgement proves the Feed opened. */
async function openFeed(client: IWindowClient): Promise<boolean> {
  const channel = new MessageChannel();
  return new Promise((resolve) => {
    let finished = false;
    const finish = (opened: boolean): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      channel.port1.close();
      resolve(opened);
    };
    const timer = setTimeout(() => finish(false), PAGE_ACK_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => finish(event.data === 'opened');
    try {
      client.postMessage({ type: 'open-feed' }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

async function bringPageForward(scope: IWorkerScope): Promise<unknown> {
  const origin = new URL(scope.registration.scope).origin;
  const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = await currentPage(scope, windows, origin);
  if (open !== undefined) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (await openFeed(open)) {
        return await Promise.race([
          open.focus(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error('The page did not focus')),
              PAGE_FOCUS_TIMEOUT_MS,
            );
          }),
        ]);
      }
    } catch {
      // allow-fallback: a window the browser will not focus is no window; the page is opened instead.
    } finally {
      clearTimeout(timer);
    }
  }
  return scope.clients.openWindow(`${origin}/?return=feed`);
}

export function installPushWorker(scope: IWorkerScope): void {
  scope.addEventListener('push', (event) => {
    const message = readPush(event);
    event.waitUntil(
      scope.registration.showNotification(message.title, {
        body: message.text,
        ...(message.tag !== '' && { tag: message.tag }),
        data: { url: message.url },
      }),
    );
  });
  scope.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(bringPageForward(scope));
  });
}
