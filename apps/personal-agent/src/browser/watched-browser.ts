/**
 * The agent's browser as a person watching it sees it: a record of what the agent did with it, the
 * submissions waiting for approval, the current page, and a way to stop it. The record never holds
 * what was typed, only how much, so a password typed into a page is not kept here.
 */
import type {
  IBrowserActionResult,
  IBrowserMark,
  IBrowserPort,
  IBrowserSnapshot,
  IBrowserView,
  IHeldSubmission,
} from '@robota-sdk/agent-product/personal';

export interface IBrowserActivity {
  readonly at: string;
  readonly action: 'open' | 'click' | 'type' | 'submit' | 'stop' | 'failed';
  readonly summary: string;
  readonly url?: string;
}

export interface IBrowserWatch {
  readonly page?: { readonly url: string; readonly title: string };
  readonly activity: readonly IBrowserActivity[];
  readonly held: readonly IHeldSubmission[];
}

export interface IWatchedBrowser {
  /** The port the agent's tools use; every call is recorded. */
  readonly port: IBrowserPort;
  watch(): IBrowserWatch;
  snapshot(): Promise<IBrowserSnapshot | undefined>;
  /** Close the agent's pages; its next browser tool starts afresh. */
  stop(): Promise<void>;
}

const MAX_ACTIVITY = 30;

export function watchBrowser(
  inner: IBrowserPort,
  now: () => Date = () => new Date(),
): IWatchedBrowser {
  let activity: IBrowserActivity[] = [];
  let held: readonly IHeldSubmission[] = [];
  let page: { url: string; title: string } | undefined;
  let marks: readonly IBrowserMark[] = [];
  const record = (entry: Omit<IBrowserActivity, 'at'>): void => {
    activity = [{ at: now().toISOString(), ...entry }, ...activity].slice(0, MAX_ACTIVITY);
  };
  const saw = (view: IBrowserView): void => {
    page = { url: view.url, title: view.title };
    marks = view.marks;
  };
  const acted = (result: IBrowserActionResult): IBrowserActionResult => {
    saw(result.view);
    held = result.held ?? [];
    return result;
  };
  const label = (mark: number): string => {
    const found = marks.find((entry) => entry.mark === mark);
    if (found === undefined) return `element ${mark}`;
    const name = found.name.replace(/\s+/gu, ' ').trim().slice(0, 60);
    return name === '' ? `a ${found.role}` : `"${name}" (${found.role})`;
  };
  const failing = async <T>(what: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      record({
        action: 'failed',
        summary: `${what} failed: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          200,
        ),
      });
      throw error;
    }
  };
  const port: IBrowserPort = {
    open: (url) =>
      failing(`Opening ${url}`, async () => {
        const view = await inner.open(url);
        saw(view);
        held = [];
        record({ action: 'open', summary: `Opened ${view.title || view.url}`, url: view.url });
        return view;
      }),
    view: async () => {
      const view = await inner.view();
      saw(view);
      return view;
    },
    click: (mark) =>
      failing(`Clicking ${label(mark)}`, async () => {
        const target = label(mark);
        const result = acted(await inner.click(mark));
        record({ action: 'click', summary: `Clicked ${target}`, url: result.view.url });
        return result;
      }),
    type: (mark, text, pressEnter) =>
      failing(`Typing into ${label(mark)}`, async () => {
        const target = label(mark);
        const result = acted(await inner.type(mark, text, pressEnter));
        record({
          action: 'type',
          summary: `Typed ${text.length} characters into ${target}${pressEnter === true ? ' and pressed Enter' : ''}`,
          url: result.view.url,
        });
        return result;
      }),
    submitHeld: (id, expected) =>
      failing(`Sending ${expected.method} ${expected.url}`, async () => {
        const result = acted(await inner.submitHeld(id, expected));
        record({
          action: 'submit',
          summary: `Sent ${expected.method} ${expected.url}`,
          url: result.view.url,
        });
        return result;
      }),
    close: async () => {
      await inner.close();
      page = undefined;
      held = [];
    },
  };
  return {
    port,
    watch: () => ({ ...(page !== undefined && { page }), activity, held }),
    snapshot: async () => (inner.snapshot === undefined ? undefined : inner.snapshot()),
    stop: async () => {
      await port.close();
      record({ action: 'stop', summary: 'Stopped by you: the pages were closed' });
    },
  };
}
