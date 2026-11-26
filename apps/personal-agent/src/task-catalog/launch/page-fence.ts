/**
 * The one page a launched run may open: the address the person named, kept with their request. The
 * run's prompt asks the model to open nothing else, but a prompt asks and only the host decides, so
 * the browser a run reads through answers for that one address and for no other. An outcome decided
 * afterwards cannot unmake a read, so what is not allowed is stopped before it is read.
 *
 * An address is the same address as the named one when `pageKey` spells both alike, the one notion the
 * outcome's own check uses, and the browser is asked for that spelling and not for the text the model
 * wrote. A page the browser turns out to be on is judged the same way once it has answered: one that
 * is somewhere else (a redirect, a page that moved on its own, a page another chat left the browser
 * on) is withheld, and the run must open a page again before it may look at one. Every refusal throws
 * before the page can be recorded as read, and is kept for the run, so the outcome knows it happened.
 *
 * The refusal the model is told is one fixed sentence. It carries no page text, no address the run
 * asked for and no address the browser landed on: what a page or a redirect says reaches nobody.
 */
import { BrowserNavigationRefusedError } from '@robota-sdk/agent-product/personal';

import { pageKey, refusalOf } from './receipts.js';

import type { IBrowserPort, IBrowserView } from '@robota-sdk/agent-product/personal';
import type { IPageRefusal, TRefusalReason } from './types.js';

export interface IPageFenceOptions {
  /** The addresses the person named, each as `pageKey` spells it. With none, every call is refused. */
  readonly pages: ReadonlySet<string>;
  /** Keeps a refusal for the run. A failure to keep it is not the run's to suffer: the call is still refused. */
  readonly refused: (refusal: IPageRefusal) => Promise<void>;
  readonly now?: () => Date;
}

/** The one answer for every refusal; a fixed sentence, so nothing a call carried comes back in it. */
const fenceError = (): BrowserNavigationRefusedError =>
  new BrowserNavigationRefusedError(
    'that page',
    'this task may open only the page the person named',
  );

/**
 * The browser port with only `open` and `view` answering, and only for the named page. `click`, `type`,
 * `submitHeld` and `close` are refused whatever they are given, so a tool list that grows later gives a
 * run nothing it was not offered: a run reads, and the browser itself belongs to the person.
 */
export function fencedBrowser(inner: IBrowserPort, options: IPageFenceOptions): IBrowserPort {
  const now = options.now ?? (() => new Date());
  /** Whether this run's latest open landed on the named page, and nothing has led it away since. */
  let landed = false;

  const named = (address: string): boolean => {
    const key = pageKey(address);
    return key !== undefined && options.pages.has(key);
  };

  const refuse = async (
    tool: 'open' | 'view',
    reason: TRefusalReason,
    addresses: { readonly requested?: string; readonly address?: string } = {},
  ): Promise<never> => {
    try {
      await options.refused(refusalOf({ tool, reason, ...addresses }, now()));
    } catch {
      // allow-fallback: a refusal that could not be kept loses the note of it, never the refusal itself.
    }
    throw fenceError();
  };

  const deny = (): Promise<never> => Promise.reject(fenceError());

  return {
    open: async (raw) => {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        // allow-fallback: text that is not an address names no page, so it is refused like any other.
        return refuse('open', 'unnamed');
      }
      if (url.username !== '' || url.password !== '' || !named(url.href))
        return refuse('open', 'unnamed', { requested: url.href });
      // The page the browser is on is not known to be the named one until it has answered.
      landed = false;
      const view: IBrowserView = await inner.open(url.href);
      if (!named(view.url))
        return refuse('open', 'landed-elsewhere', { requested: url.href, address: view.url });
      landed = true;
      return view;
    },
    view: async () => {
      if (!landed) return refuse('view', 'not-opened');
      const view = await inner.view();
      if (named(view.url)) return view;
      landed = false;
      return refuse('view', 'landed-elsewhere', { address: view.url });
    },
    click: deny,
    type: deny,
    submitHeld: deny,
    close: deny,
  };
}
