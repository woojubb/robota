/**
 * The personal agent's browser: a headless Chromium with its own profile under the agent's state
 * directory, driven through Playwright and offered to the agent through the personal pack's browser
 * port.
 *
 * Every request the page makes passes one gate. Only http and https leave; loopback, private,
 * link-local and metadata addresses are refused, whether named directly or reached through a name
 * that resolves to one, unless the host explicitly allows one (a local test site). A request that
 * writes (anything but GET, HEAD or OPTIONS) is held and reported instead of sent, and goes out only
 * when the person approves that submission: the browser cannot be talked into sending data by text on
 * a page, because the page text never reaches the gate. WebSockets, service workers and downloads,
 * which would carry data past that gate, are refused outright.
 */
import { existsSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';

import {
  BrowserNavigationRefusedError,
  BrowserUnavailableError,
} from '@robota-sdk/agent-product/personal';

import type {
  IBrowserActionResult,
  IBrowserMark,
  IBrowserPort,
  IBrowserView,
  IHeldSubmission,
} from '@robota-sdk/agent-product/personal';

const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEFAULT_MAX_TEXT = 6000;
const ACTION_SETTLE_MS = 1500;
const RESOLVED_TTL_MS = 60_000;

export interface IPlaywrightBrowserOptions {
  /** The browser profile directory, inside the agent's state directory. */
  readonly profileDir: string;
  /** A Chromium binary; defaults to `PERSONAL_AGENT_CHROMIUM`, the preinstalled one, then Playwright's. */
  readonly executablePath?: string;
  /** Exact `host:port` origins allowed despite being loopback or private, such as a local test site. */
  readonly allowedHosts?: readonly string[];
  readonly maxTextChars?: number;
  /** Resolves a host name to its addresses; defaults to the system resolver. */
  readonly resolveHost?: (hostname: string) => Promise<readonly string[]>;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

interface IPlaywrightRequest {
  method(): string;
  url(): string;
  postData(): string | null;
  headers(): Record<string, string>;
  isNavigationRequest(): boolean;
}
interface IPlaywrightRoute {
  request(): IPlaywrightRequest;
  continue(overrides?: {
    method?: string;
    postData?: string;
    headers?: Record<string, string>;
  }): Promise<void>;
  abort(reason?: string): Promise<void>;
}
interface IPlaywrightLocator {
  click(options: { timeout: number }): Promise<void>;
  fill(value: string, options: { timeout: number }): Promise<void>;
  press(key: string, options: { timeout: number }): Promise<void>;
}
interface IPlaywrightPage {
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
  locator(selector: string): IPlaywrightLocator;
  waitForLoadState(state: string, options: { timeout: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
}
interface IPlaywrightWebSocketRoute {
  close(options: { code: number; reason: string }): Promise<void>;
}
interface IPlaywrightContext {
  request: {
    fetch(
      url: string,
      options: { method: string; data?: string; headers?: Record<string, string> },
    ): Promise<unknown>;
  };
  pages(): IPlaywrightPage[];
  newPage(): Promise<IPlaywrightPage>;
  route(pattern: string, handler: (route: IPlaywrightRoute) => Promise<void>): Promise<void>;
  routeWebSocket(
    pattern: string,
    handler: (socket: IPlaywrightWebSocketRoute) => Promise<void>,
  ): Promise<void>;
  close(): Promise<void>;
}
interface IChromium {
  executablePath(): string;
  launchPersistentContext(
    dir: string,
    options: Record<string, unknown>,
  ): Promise<IPlaywrightContext>;
}

/** Whether a host is one the browser must not reach on its own: loopback, private, link-local, metadata. */
export function isRestrictedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  )
    return true;
  const family = isIP(host);
  if (family === 4) {
    const [a = 0, b = 0] = host.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (family === 6) {
    return (
      host === '::1' ||
      host === '::' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80') ||
      host.startsWith('::ffff:')
    );
  }
  return false;
}

/** Field names a write request carried, from a form body or a JSON object; never the values. */
export function fieldNames(body: string | null, contentType: string | undefined): string[] {
  if (body === null || body === '') return [];
  if (contentType?.includes('application/json')) {
    try {
      const parsed: unknown = JSON.parse(body);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? Object.keys(parsed)
        : [];
    } catch {
      return [];
    }
  }
  if (contentType?.includes('multipart/form-data')) {
    return [...body.matchAll(/name="([^"]+)"/g)].map((match) => match[1]!);
  }
  return [...new URLSearchParams(body).keys()];
}

function loadChromium(): IChromium {
  for (const root of [import.meta.url, `${process.cwd()}/`]) {
    try {
      return (createRequire(root)('playwright') as { chromium: IChromium }).chromium;
    } catch {
      // Try the next root.
    }
  }
  throw new BrowserUnavailableError('Playwright is not installed');
}

/** Whether a usable Chromium exists on this machine, without launching it. */
export function findChromiumExecutable(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const configured = environment['PERSONAL_AGENT_CHROMIUM'];
  if (configured !== undefined && configured !== '' && existsSync(configured)) return configured;
  if (existsSync(PREINSTALLED_CHROMIUM)) return PREINSTALLED_CHROMIUM;
  try {
    const path = loadChromium().executablePath();
    return existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

/** What it takes to send a held request later, exactly as the page made it. */
interface IHeldRequest {
  readonly submission: IHeldSubmission;
  readonly postData: string | null;
  readonly headers: Record<string, string>;
  readonly navigation: boolean;
}

export function createPlaywrightBrowser(options: IPlaywrightBrowserOptions): IBrowserPort {
  const allowed = new Set(options.allowedHosts ?? []);
  const maxText = options.maxTextChars ?? DEFAULT_MAX_TEXT;
  let context: IPlaywrightContext | undefined;
  let page: IPlaywrightPage | undefined;
  let launching: Promise<IPlaywrightPage> | undefined;
  let sequence = 0;
  const held = new Map<string, IHeldRequest>();
  let heldDuringAction: IHeldSubmission | undefined;
  /** An approved navigation: the next GET to its URL is sent as the held request instead. */
  let approvedNavigation: IHeldRequest | undefined;

  const resolveHost =
    options.resolveHost ??
    (async (hostname: string) =>
      (await lookup(hostname, { all: true })).map((entry) => entry.address));
  const resolved = new Map<string, { restricted: boolean; at: number }>();

  /** Whether a public-looking name resolves to a restricted address. Resolution failures pass: the browser's own lookup then fails too. */
  const resolvesRestricted = async (hostname: string): Promise<boolean> => {
    const cached = resolved.get(hostname);
    if (cached !== undefined && Date.now() - cached.at < RESOLVED_TTL_MS) return cached.restricted;
    let restricted = false;
    try {
      restricted = (await resolveHost(hostname)).some((address) => isRestrictedHost(address));
    } catch {
      restricted = false;
    }
    resolved.set(hostname, { restricted, at: Date.now() });
    return restricted;
  };

  const refusal = async (url: string): Promise<string | undefined> => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return 'not a valid URL';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return parsed.protocol === 'data:' ||
        parsed.protocol === 'blob:' ||
        parsed.protocol === 'about:'
        ? undefined
        : `${parsed.protocol} is not allowed`;
    }
    if (allowed.has(parsed.host)) return undefined;
    const restricted =
      isRestrictedHost(parsed.hostname) ||
      (isIP(parsed.hostname.replace(/^\[|\]$/g, '')) === 0 &&
        (await resolvesRestricted(parsed.hostname)));
    return restricted ? 'private and loopback addresses are not reachable' : undefined;
  };

  const gate = async (route: IPlaywrightRoute): Promise<void> => {
    const request = route.request();
    if ((await refusal(request.url())) !== undefined) {
      await route.abort('blockedbyclient');
      return;
    }
    const method = request.method().toUpperCase();
    if (
      approvedNavigation !== undefined &&
      request.isNavigationRequest() &&
      request.url() === approvedNavigation.submission.url
    ) {
      const approved = approvedNavigation;
      approvedNavigation = undefined;
      await route.continue({
        method: approved.submission.method,
        headers: approved.headers,
        ...(approved.postData !== null && { postData: approved.postData }),
      });
      return;
    }
    if (READ_METHODS.has(method)) {
      await route.continue();
      return;
    }
    sequence += 1;
    const headers = request.headers();
    const submission: IHeldSubmission = {
      id: `submission-${sequence}`,
      method,
      url: request.url(),
      fields: fieldNames(request.postData(), headers['content-type']),
    };
    held.set(submission.id, {
      submission,
      postData: request.postData(),
      headers,
      navigation: request.isNavigationRequest(),
    });
    heldDuringAction = submission;
    await route.abort('blockedbyclient');
  };

  const ensurePage = async (): Promise<IPlaywrightPage> => {
    if (page !== undefined) return page;
    launching ??= (async () => {
      const executablePath = options.executablePath ?? findChromiumExecutable(options.environment);
      if (executablePath === undefined)
        throw new BrowserUnavailableError('no Chromium is installed on this machine');
      try {
        context = await loadChromium().launchPersistentContext(options.profileDir, {
          headless: true,
          executablePath,
          serviceWorkers: 'block',
          acceptDownloads: false,
        });
      } catch (error) {
        throw new BrowserUnavailableError(
          error instanceof Error ? error.message.split('\n')[0]! : String(error),
        );
      }
      await context.route('**/*', gate);
      await context.routeWebSocket('**/*', async (socket) => {
        await socket.close({ code: 1008, reason: 'WebSockets are not available in this browser' });
      });
      page = context.pages()[0] ?? (await context.newPage());
      return page;
    })();
    return launching;
  };

  const view = async (): Promise<IBrowserView> => {
    const current = await ensurePage();
    const snapshot = await current.evaluate((limit: number) => {
      const interactive =
        'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem], [onclick]';
      const marks: { mark: number; role: string; name: string }[] = [];
      let next = 1;
      for (const element of Array.from(document.querySelectorAll<HTMLElement>(interactive))) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        element.setAttribute('data-robota-mark', String(next));
        const tag = element.tagName.toLowerCase();
        const input = element as HTMLInputElement;
        const role =
          element.getAttribute('role') ??
          (tag === 'a'
            ? 'link'
            : tag === 'input'
              ? input.type === 'submit' || input.type === 'button'
                ? 'button'
                : input.type === 'checkbox'
                  ? 'checkbox'
                  : 'textbox'
              : tag === 'select'
                ? 'combobox'
                : tag === 'textarea'
                  ? 'textbox'
                  : tag);
        const labelled =
          element.id === ''
            ? null
            : document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        const name =
          input.type === 'password'
            ? 'password field'
            : (
                element.getAttribute('aria-label') ??
                labelled?.textContent ??
                element.innerText ??
                ''
              ).trim() ||
              input.placeholder ||
              (role === 'button' ? input.value : '') ||
              element.getAttribute('title') ||
              '';
        marks.push({ mark: next, role, name: name.replace(/\s+/g, ' ').slice(0, 80) });
        next += 1;
      }
      return { text: (document.body?.innerText ?? '').slice(0, limit), marks };
    }, maxText);
    return {
      url: current.url(),
      title: await current.title(),
      text: snapshot.text,
      marks: snapshot.marks as IBrowserMark[],
    };
  };

  const act = async (action: () => Promise<void>): Promise<IBrowserActionResult> => {
    const current = await ensurePage();
    heldDuringAction = undefined;
    await action();
    await current
      .waitForLoadState('domcontentloaded', { timeout: ACTION_SETTLE_MS })
      .catch(() => undefined);
    await current.waitForTimeout(200);
    const result = {
      view: await view(),
      ...(heldDuringAction !== undefined && { held: heldDuringAction }),
    };
    heldDuringAction = undefined;
    return result;
  };

  const markLocator = async (mark: number): Promise<IPlaywrightLocator> =>
    (await ensurePage()).locator(`[data-robota-mark="${mark}"]`);

  return {
    async open(url) {
      const reason = await refusal(url);
      if (reason !== undefined) throw new BrowserNavigationRefusedError(url, reason);
      const current = await ensurePage();
      await current.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      return view();
    },
    view,
    async click(mark) {
      return act(async () => {
        await (await markLocator(mark)).click({ timeout: 5_000 });
      });
    },
    async type(mark, text, pressEnter) {
      return act(async () => {
        const locator = await markLocator(mark);
        await locator.fill(text, { timeout: 5_000 });
        if (pressEnter === true) await locator.press('Enter', { timeout: 5_000 });
      });
    },
    async submitHeld(id) {
      const entry = held.get(id);
      if (entry === undefined)
        throw new BrowserNavigationRefusedError(id, 'no such held submission');
      held.delete(id);
      if (!entry.navigation) {
        // A background request the page made: sent as made, with the browser's own cookies.
        await (context as IPlaywrightContext).request.fetch(entry.submission.url, {
          method: entry.submission.method,
          headers: entry.headers,
          ...(entry.postData !== null && { data: entry.postData }),
        });
        return { view: await view() };
      }
      // A page submission: the page goes to its target, and the gate sends that one navigation as
      // the held request, so the person sees the site's real answer.
      approvedNavigation = entry;
      try {
        return await act(async () => {
          await (
            await ensurePage()
          ).goto(entry.submission.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        });
      } finally {
        approvedNavigation = undefined;
      }
    },
    async close() {
      await context?.close().catch(() => undefined);
      context = undefined;
      page = undefined;
      launching = undefined;
    },
  };
}
