/**
 * The personal agent's push worker: it turns a message the agent pushed into a notification while the
 * page is closed, and brings the page forward when the person clicks it. It caches nothing and answers no
 * request, so it listens for these two events only.
 *
 * Its scope is the folder it is served from. The local server serves the page under a random path it
 * picks at each start, and the built worker sits beside the page's index, so the worker's scope is exactly
 * that path: it covers the page with no `Service-Worker-Allowed` header and reaches nothing else on the
 * origin. What it shows is plain text: a notification body is never markup.
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
}

/**
 * What the worker uses of its global scope. Declared here because the page's own types describe a window,
 * and the worker's scope is not one.
 */
export interface IWorkerScope {
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

/** The page address a click opens: inside this worker's own scope, or the scope itself. */
function pageAddress(scope: string, target: unknown): string {
  try {
    const address = new URL(typeof target === 'string' ? target : '', scope);
    return address.href.startsWith(scope) ? address.href : scope;
  } catch {
    // allow-fallback: an address that cannot be read opens the page itself.
    return scope;
  }
}

async function bringPageForward(scope: IWorkerScope, target: unknown): Promise<unknown> {
  const origin = new URL(scope.registration.scope).origin;
  const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((client) => new URL(client.url).origin === origin);
  if (open !== undefined) {
    try {
      return await open.focus();
    } catch {
      // allow-fallback: a window the browser will not focus is no window; the page is opened instead.
    }
  }
  return scope.clients.openWindow(pageAddress(scope.registration.scope, target));
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
    const { data } = event.notification;
    const target =
      typeof data === 'object' && data !== null ? (data as { url?: unknown }).url : undefined;
    event.waitUntil(bringPageForward(scope, target));
  });
}
