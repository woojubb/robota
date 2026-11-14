/**
 * The personal agent's browser: a headless Chromium with its own profile under the agent's state
 * directory, driven through Playwright and offered to the agent through the personal pack's browser
 * port.
 *
 * Every request the page makes passes one gate, and so does every hop of a redirect. Only http and
 * https leave; loopback, private, link-local and metadata addresses are refused, whether named directly
 * or reached through a name that resolves to one, unless the host explicitly allows one (a local test
 * site). A request that writes (any method but GET, HEAD or OPTIONS) is held when the agent's own click
 * or keystroke caused it, and dropped otherwise; a held request goes out only when the person approves
 * that submission, naming its method and address. The browser cannot be talked into sending a write by
 * text on a page, because the page text never reaches the gate. WebSockets, service workers and
 * downloads, which would carry data past the gate, are refused outright. Data a page puts in a URL is
 * not held: reading the web means sending GET requests.
 */
import { lookup } from 'node:dns/promises';
import { existsSync } from 'node:fs';
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
import type { BrowserContext, Page, Route } from 'playwright';

type TPlaywright = typeof import('playwright');

const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEFAULT_MAX_TEXT = 6000;
const ACTION_SETTLE_MS = 1500;
const RESOLVED_TTL_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const REFUSED = 'private and loopback addresses are not reachable';

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

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Whether an address or name is one the browser must not reach on its own. */
export function isRestrictedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    ['.localhost', '.local', '.internal'].some((suffix) => host.endsWith(suffix))
  ) {
    return true;
  }
  const family = isIP(host);
  if (family === 4) {
    const [a = 0, b = 0] = host.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (family === 6) {
    return (
      host === '::1' ||
      host === '::' ||
      ['fc', 'fd', 'fe80', 'ff', '::ffff:', '64:ff9b:'].some((prefix) => host.startsWith(prefix))
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

function loadPlaywright(): TPlaywright {
  for (const root of [import.meta.url, `${process.cwd()}/`]) {
    try {
      return createRequire(root)('playwright') as TPlaywright;
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
    const path = loadPlaywright().chromium.executablePath();
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
  /** The origin of the frame that made it, for deciding whether its cookies may go along. */
  readonly pageOrigin: string;
}

interface IForward {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly postData?: string;
}

export function createPlaywrightBrowser(options: IPlaywrightBrowserOptions): IBrowserPort {
  const allowed = new Set(options.allowedHosts ?? []);
  const maxText = options.maxTextChars ?? DEFAULT_MAX_TEXT;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let launching: Promise<Page> | undefined;
  let sequence = 0;
  /** Writes held by the agent's most recent click or keystroke; any other action discards them. */
  const held = new Map<string, IHeldRequest>();
  /** True only while the agent's own click or keystroke runs: the only time a write is held. */
  let acting = false;
  /** An approved page submission: the next navigation to its URL is sent as the held request. */
  let approvedNavigation: IHeldRequest | undefined;
  /** Why the page's last navigation was stopped, if it was; `navigate` turns it into a refusal. */
  let stoppedNavigation: string | undefined;

  const resolveHost =
    options.resolveHost ??
    (async (hostname: string) =>
      (await lookup(hostname, { all: true })).map((entry) => entry.address));
  const resolved = new Map<string, { restricted: boolean; at: number }>();

  /** Whether a public-looking name resolves to a restricted address. A failed lookup passes: the browser's own lookup fails too. */
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
      return ['data:', 'blob:', 'about:'].includes(parsed.protocol)
        ? undefined
        : `${parsed.protocol} is not allowed`;
    }
    if (allowed.has(parsed.host)) return undefined;
    const bare = parsed.hostname.replace(/^\[|\]$/g, '');
    const restricted =
      isRestrictedHost(bare) || (isIP(bare) === 0 && (await resolvesRestricted(bare)));
    return restricted ? REFUSED : undefined;
  };

  /**
   * Send one hop ourselves without following redirects, so a redirect's target passes the gate before
   * the browser follows it: the browser routes that next hop through the gate again.
   */
  /**
   * Stop a request. A navigation of the page itself is answered with a small page saying why, rather
   * than aborted: an aborted navigation makes Chromium start an error page of its own, and the next
   * action would race it. Everything else (a subresource, a frame) is aborted.
   */
  const stop = async (route: Route, reason: string, status: number): Promise<void> => {
    const request = route.request();
    if (
      page !== undefined &&
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame()
    ) {
      stoppedNavigation = reason;
      await route.fulfill({
        status,
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><title>Not opened</title><p>Your agent's browser did not open this page: ${escapeHtml(reason)}.</p>`,
      });
      return;
    }
    await route.abort(status === 403 ? 'blockedbyclient' : 'failed');
  };

  const forward = async (route: Route, overrides: IForward = {}): Promise<void> => {
    let response: Awaited<ReturnType<Route['fetch']>>;
    try {
      response = await route.fetch({
        ...overrides,
        maxRedirects: 0,
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    } catch (error) {
      // allow-fallback: an unreachable host fails that one request, as it would in any browser.
      const detail =
        error instanceof Error
          ? error.message.split('\n')[0]!.replace(/^route\.fetch: /u, '')
          : String(error);
      await stop(route, `the page did not load (${detail})`, 502);
      return;
    }
    const location = response.headers()['location'];
    if (response.status() >= 300 && response.status() < 400 && location !== undefined) {
      if ((await refusal(new URL(location, route.request().url()).href)) !== undefined) {
        await stop(route, `it led to an address that is not reachable (${REFUSED})`, 403);
        return;
      }
    }
    await route.fulfill({ response });
  };

  /** A route handler must never reject: an unhandled rejection would take the agent down with the page. */
  const gate = async (route: Route): Promise<void> => {
    try {
      await decide(route);
    } catch {
      // allow-fallback: whatever went wrong deciding this request, it does not go out.
      await route.abort('failed').catch(() => undefined);
    }
  };

  const decide = async (route: Route): Promise<void> => {
    const request = route.request();
    const refused = await refusal(request.url());
    if (refused !== undefined) {
      await stop(route, refused, 403);
      return;
    }
    const method = request.method().toUpperCase();
    const approved = approvedNavigation;
    if (
      approved !== undefined &&
      request.isNavigationRequest() &&
      request.url() === approved.submission.url
    ) {
      approvedNavigation = undefined;
      await forward(route, {
        method: approved.submission.method,
        headers: approved.headers,
        ...(approved.postData !== null && { postData: approved.postData }),
      });
      return;
    }
    if (READ_METHODS.has(method)) {
      await forward(route);
      return;
    }
    if (acting) {
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
        pageOrigin: new URL(request.frame().url()).origin,
      });
    }
    await route.abort('blockedbyclient');
  };

  const ensurePage = async (): Promise<Page> => {
    if (page !== undefined) return page;
    launching ??= (async () => {
      const executablePath = options.executablePath ?? findChromiumExecutable(options.environment);
      if (executablePath === undefined)
        throw new BrowserUnavailableError('no Chromium is installed on this machine');
      try {
        context = await loadPlaywright().chromium.launchPersistentContext(options.profileDir, {
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
        const inputRole =
          input.type === 'submit' || input.type === 'button'
            ? 'button'
            : input.type === 'checkbox'
              ? 'checkbox'
              : 'textbox';
        const role =
          element.getAttribute('role') ??
          (tag === 'a'
            ? 'link'
            : tag === 'input'
              ? inputRole
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

  /** Run an action and report what it held; a new action discards holds the agent did not submit. */
  const act = async (
    action: (current: Page) => Promise<void>,
    holds: boolean,
  ): Promise<IBrowserActionResult> => {
    const current = await ensurePage();
    held.clear();
    acting = holds;
    try {
      await action(current);
      await current
        .waitForLoadState('domcontentloaded', { timeout: ACTION_SETTLE_MS })
        .catch(() => undefined);
      await current.waitForTimeout(200);
    } finally {
      acting = false;
    }
    const submissions = [...held.values()].map((entry) => entry.submission);
    return { view: await view(), ...(submissions.length > 0 && { held: submissions }) };
  };

  /** Go to a URL, turning a navigation the gate stopped, or the network failed, into a refusal the model can read. */
  const navigate = async (current: Page, url: string): Promise<void> => {
    stoppedNavigation = undefined;
    try {
      await current.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0]! : String(error);
      throw new BrowserNavigationRefusedError(
        url,
        `the page did not load (${message.replace(/^page\.goto: /u, '')})`,
      );
    }
    if (stoppedNavigation !== undefined)
      throw new BrowserNavigationRefusedError(url, stoppedNavigation);
  };

  const markLocator = (current: Page, mark: number) =>
    current.locator(`[data-robota-mark="${mark}"]`);

  /** Resend a background request the page made, with the profile's cookies only for the page's own origin. */
  const resendBackground = async (entry: IHeldRequest): Promise<void> => {
    const sameOrigin = new URL(entry.submission.url).origin === entry.pageOrigin;
    const request = sameOrigin
      ? (context as BrowserContext).request
      : await loadPlaywright().request.newContext();
    try {
      await request.fetch(entry.submission.url, {
        method: entry.submission.method,
        headers: entry.headers,
        maxRedirects: 0,
        timeout: NAVIGATION_TIMEOUT_MS,
        ...(entry.postData !== null && { data: entry.postData }),
      });
    } finally {
      if (!sameOrigin) await request.dispose();
    }
  };

  return {
    async open(url) {
      const reason = await refusal(url);
      if (reason !== undefined) throw new BrowserNavigationRefusedError(url, reason);
      const result = await act(async (current) => {
        await navigate(current, url);
      }, false);
      return result.view;
    },
    view,
    async click(mark) {
      return act(async (current) => {
        await markLocator(current, mark).click({ timeout: 5_000 });
      }, true);
    },
    async type(mark, text, pressEnter) {
      return act(async (current) => {
        const locator = markLocator(current, mark);
        await locator.fill(text, { timeout: 5_000 });
        if (pressEnter === true) await locator.press('Enter', { timeout: 5_000 });
      }, true);
    },
    async submitHeld(id, expected) {
      const entry = held.get(id);
      if (entry === undefined) {
        throw new BrowserNavigationRefusedError(
          id,
          "no such held submission; only the last action's submissions can be sent",
        );
      }
      if (
        entry.submission.method !== expected.method.toUpperCase() ||
        entry.submission.url !== expected.url
      ) {
        throw new BrowserNavigationRefusedError(
          id,
          'the method or address does not match the held submission',
        );
      }
      const reason = await refusal(entry.submission.url);
      if (reason !== undefined)
        throw new BrowserNavigationRefusedError(entry.submission.url, reason);
      held.delete(id);
      if (!entry.navigation) {
        await resendBackground(entry);
        return { view: await view() };
      }
      // A page submission: the page goes to its target, and the gate sends that one navigation as the
      // held request, so the person sees the site's real answer.
      approvedNavigation = entry;
      try {
        return await act(async (current) => {
          await navigate(current, entry.submission.url);
        }, false);
      } finally {
        approvedNavigation = undefined;
      }
    },
    async close() {
      await context?.close().catch(() => undefined);
      context = undefined;
      page = undefined;
      launching = undefined;
      held.clear();
    },
  };
}
