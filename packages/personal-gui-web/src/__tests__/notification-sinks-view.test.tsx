// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api.js';
import { openQuestionCount, titleWithCount, usePageNotifications } from '../notifications.js';
import { BrowserNotifications } from '../views/BrowserNotifications.js';
import { NotificationAddress } from '../views/NotificationAddress.js';
import { SettingsView } from '../views/Settings.js';

import type {
  IBrowserNotificationView,
  IFeedItemView,
  IPersonalApi,
  IWebhookView,
} from '../api.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.title = '';
});

/** What stands for a token in an address; built from pieces so no scan takes it for one. */
const TOKEN = ['tok', 'en-', 'Qx7', 'kd2', 'Lm9'].join('');
const ADDRESS = `https://push.example.test/topics/${TOKEN}`;

const NOT_SET: IWebhookView = { configured: false, format: 'plain' };
const SET: IWebhookView = { configured: true, host: 'push.example.test', format: 'json' };

function fakeApi(extra: Partial<IPersonalApi> = {}): IPersonalApi {
  return { webhook: async () => NOT_SET, ...extra } as unknown as IPersonalApi;
}

const form = (): HTMLElement => screen.getByRole('form', { name: 'Notification address' });
const addressField = async (): Promise<HTMLInputElement> =>
  (await screen.findByLabelText('Send notifications to this address')) as HTMLInputElement;
const status = (): string => within(form()).getByRole('status').textContent ?? '';
const typeAddress = async (value: string): Promise<void> => {
  fireEvent.change(await addressField(), { target: { value } });
};

describe('the notification address in Settings', () => {
  it('is empty by default, says that none is set, and has nothing to remove or test', async () => {
    render(<NotificationAddress api={fakeApi()} />);
    const input = await addressField();
    expect(input.value).toBe('');
    expect(input.type).toBe('url');
    expect(input.autocomplete).toBe('off');
    expect(screen.getByText('No address is set. It must start with https://.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Send a test' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(status()).toBe('');
  });

  it('labels every field and button, so each one is reached by its name', async () => {
    render(<NotificationAddress api={fakeApi()} />);
    await addressField();
    expect(
      screen.getByRole('textbox', { name: 'Send notifications to this address' }),
    ).toBeTruthy();
    const format = screen.getByRole('combobox', { name: 'Format' }) as HTMLSelectElement;
    expect([...format.options].map((option) => option.value)).toEqual(['plain', 'json']);
    expect(format.value).toBe('plain');
    for (const name of ['Save', 'Remove', 'Send a test'])
      expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(
      screen
        .getByRole('textbox', { name: 'Send notifications to this address' })
        .getAttribute('aria-describedby'),
    ).toBeTruthy();
  });

  it('sends the address once, empties the field and shows only the host afterwards', async () => {
    const save = vi.fn(async (): Promise<IWebhookView> => ({ ...SET, format: 'plain' }));
    render(<NotificationAddress api={fakeApi({ saveWebhook: save })} />);
    await typeAddress(`  ${ADDRESS}  `);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(status()).toBe('Saved. Notifications go to push.example.test.'));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ url: ADDRESS, format: 'plain' });
    expect((await addressField()).value).toBe('');
    expect(
      screen.getByText(/Notifications go to push\.example\.test\. Type the address again/u),
    ).toBeTruthy();
    // Nothing the page shows holds the address or its token.
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(
      [...document.querySelectorAll('input')].some((input) => input.value.includes(TOKEN)),
    ).toBe(false);
  });

  it('sends the format the person chose', async () => {
    const save = vi.fn(async (): Promise<IWebhookView> => SET);
    render(<NotificationAddress api={fakeApi({ saveWebhook: save })} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Format' }), {
      target: { value: 'json' },
    });
    await typeAddress(ADDRESS);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ url: ADDRESS, format: 'json' }));
    await waitFor(() =>
      expect((screen.getByRole('combobox', { name: 'Format' }) as HTMLSelectElement).value).toBe(
        'json',
      ),
    );
  });

  it('shows the agent’s refusal in the status line and keeps what the person typed', async () => {
    const save = vi.fn(async () => {
      throw new ApiError(400, 'The notification address must start with https://');
    });
    render(<NotificationAddress api={fakeApi({ saveWebhook: save })} />);
    await typeAddress('http://push.example.test/x');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(status()).toBe('The notification address must start with https://'));
    expect((await addressField()).value).toBe('http://push.example.test/x');
    // The next edit starts afresh: the old refusal is gone.
    await typeAddress('https://push.example.test/x');
    expect(status()).toBe('');
  });

  it('sends a blank address as it is, for the agent to refuse', async () => {
    const save = vi.fn(async () => {
      throw new ApiError(400, 'The notification address must be a web address');
    });
    render(<NotificationAddress api={fakeApi({ saveWebhook: save })} />);
    await addressField();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(status()).toBe('The notification address must be a web address'));
    expect(save).toHaveBeenCalledWith({ url: '', format: 'plain' });
  });

  it('shows the host of an address that is set, never the address, and can remove it or send a test', async () => {
    const remove = vi.fn(async (): Promise<IWebhookView> => NOT_SET);
    const test = vi.fn(async () => ({ ok: true as const }));
    render(
      <NotificationAddress
        api={fakeApi({ webhook: async () => SET, removeWebhook: remove, testWebhook: test })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/Notifications go to push\.example\.test\./u)).toBeTruthy(),
    );
    expect((await addressField()).value).toBe('');
    expect((screen.getByRole('combobox', { name: 'Format' }) as HTMLSelectElement).value).toBe(
      'json',
    );
    expect(document.body.textContent).not.toContain(TOKEN);

    fireEvent.click(screen.getByRole('button', { name: 'Send a test' }));
    await waitFor(() => expect(status()).toBe('Test sent. Check that it arrived.'));
    expect(test).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(status()).toBe('Removed. Notifications no longer go to an address.'),
    );
    expect(remove).toHaveBeenCalledTimes(1);
    expect(screen.getByText('No address is set. It must start with https://.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Send a test' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows why a test was not taken, in the agent’s words', async () => {
    const test = vi.fn(async () => {
      throw new ApiError(
        400,
        'The notification address (push.example.test) answered with status 404',
      );
    });
    render(<NotificationAddress api={fakeApi({ webhook: async () => SET, testWebhook: test })} />);
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Send a test' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send a test' }));
    await waitFor(() =>
      expect(status()).toBe(
        'The notification address (push.example.test) answered with status 404',
      ),
    );
  });

  it('is part of the Settings view, below the limits', async () => {
    const api = fakeApi({
      settings: async () => ({
        providerTypes: ['openai'],
        stateDir: '/home/person/.personal-agent',
        browser: { available: false },
      }),
      delivery: async () => ({
        settings: {
          dailyLimit: 3,
          quietHours: { enabled: true, from: '22:00', to: '08:00' },
          digest: { enabled: true, at: '08:00' },
        },
        today: { sent: 0, limit: 3 },
        waitingInDigest: 0,
      }),
    });
    render(<SettingsView api={api} />);
    expect(await screen.findByRole('form', { name: 'Notifications' })).toBeTruthy();
    expect(await screen.findByRole('form', { name: 'Notification address' })).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: 'Allow notifications in this browser' }),
    ).toBeTruthy();
  });
});

/** A stand-in for the browser's `Notification`, which records each one shown. */
class FakeNotification {
  static permission: NotificationPermission = 'default';
  static requested = 0;
  static answer: NotificationPermission = 'granted';
  static shown: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  closed = false;
  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    FakeNotification.shown.push(this);
  }
  static async requestPermission(): Promise<NotificationPermission> {
    FakeNotification.requested += 1;
    FakeNotification.permission = FakeNotification.answer;
    return FakeNotification.answer;
  }
  close(): void {
    this.closed = true;
  }
}

function stubNotification(permission: NotificationPermission): void {
  FakeNotification.permission = permission;
  FakeNotification.requested = 0;
  FakeNotification.answer = 'granted';
  FakeNotification.shown = [];
  vi.stubGlobal('Notification', FakeNotification);
}

describe('notifications in this browser, in Settings', () => {
  it('asks the browser only when the person presses the button, never when the page loads', async () => {
    stubNotification('default');
    render(<BrowserNotifications />);
    expect(FakeNotification.requested).toBe(0);
    expect(screen.getByRole('status').textContent).toMatch(/Not allowed yet/u);
    const button = screen.getByRole('button', { name: 'Allow notifications in this browser' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^Allowed\./u));
    expect(FakeNotification.requested).toBe(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the button when the person closes the browser’s question without answering it', async () => {
    stubNotification('default');
    FakeNotification.answer = 'default';
    render(<BrowserNotifications />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow notifications in this browser' }));
    await waitFor(() => expect(FakeNotification.requested).toBe(1));
    expect(screen.getByRole('status').textContent).toMatch(/Not allowed yet/u);
    expect(
      (
        screen.getByRole('button', {
          name: 'Allow notifications in this browser',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it('says what the browser decided, and offers nothing more to press when it is not undecided', async () => {
    stubNotification('denied');
    render(<BrowserNotifications />);
    expect(screen.getByRole('status').textContent).toMatch(/^Blocked\./u);
    expect(
      (
        screen.getByRole('button', {
          name: 'Allow notifications in this browser',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    cleanup();
    stubNotification('granted');
    render(<BrowserNotifications />);
    expect(screen.getByRole('status').textContent).toMatch(/^Allowed\./u);
    expect(FakeNotification.requested).toBe(0);
  });

  it('says so, and does not throw, when the browser has no notifications', () => {
    vi.stubGlobal('Notification', undefined);
    render(<BrowserNotifications />);
    expect(screen.getByRole('status').textContent).toBe('This browser cannot show notifications.');
    expect(
      (
        screen.getByRole('button', {
          name: 'Allow notifications in this browser',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

const message = (id: number, title = `Question ${id}`): IBrowserNotificationView => ({
  id,
  at: '2026-11-16T01:00:00Z',
  kind: 'question',
  title,
  text: `${title}: Was this you?\nOpen your Feed to answer.`,
});

const card = (id: string, state: 'open' | 'answered' | 'withdrawn' = 'open'): IFeedItemView => ({
  id,
  at: '2026-11-16T01:00:00Z',
  kind: 'question',
  title: `Card ${id}`,
  body: '',
  question: {
    caseId: `case-${id}`,
    text: 'Was this you?',
    options: ['Yes', 'No'],
    allowsReply: false,
    state,
  },
});

const report: IFeedItemView = {
  id: 'report-1',
  at: '2026-11-16T01:00:00Z',
  kind: 'report',
  title: 'A report',
  body: 'Done.',
};

function inFront(front: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (front ? 'visible' : 'hidden'),
  });
  vi.spyOn(document, 'hasFocus').mockReturnValue(front);
}

function Probe({
  api,
  onOpenFeed,
}: {
  readonly api: IPersonalApi;
  readonly onOpenFeed: () => void;
}): React.ReactElement {
  const { waiting } = usePageNotifications(api, onOpenFeed);
  return <p data-testid="waiting">{waiting}</p>;
}

/** Let what is waiting run: the first poll, and then each interval that has passed. */
const tick = (ms: number): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** A page whose agent answers each poll with the next of these; the last one repeats. */
function pollingApi(
  answers: { messages: IBrowserNotificationView[]; latest: number }[],
  items: IFeedItemView[],
) {
  let index = 0;
  const notifications = vi.fn(async () => answers[Math.min(index++, answers.length - 1)]!);
  const feed = vi.fn(async () => items);
  return { api: { notifications, feed } as unknown as IPersonalApi, notifications, feed };
}

describe('the page showing the agent’s messages', () => {
  it('starts from now: what was kept before the page was open is not announced', async () => {
    vi.useFakeTimers();
    stubNotification('granted');
    inFront(false);
    const { api, notifications } = pollingApi(
      [
        { messages: [], latest: 4 },
        { messages: [message(5)], latest: 5 },
      ],
      [],
    );
    render(<Probe api={api} onOpenFeed={() => undefined} />);
    await tick(0);
    expect(notifications).toHaveBeenNthCalledWith(1, undefined);
    expect(FakeNotification.shown).toEqual([]);
    await tick(5_000);
    expect(notifications).toHaveBeenNthCalledWith(2, 4);
    expect(FakeNotification.shown.map((shown) => shown.title)).toEqual(['Question 5']);
  });

  it('shows one as a notification in plain text, tagged by its id, and a click brings the feed forward', async () => {
    vi.useFakeTimers();
    stubNotification('granted');
    inFront(false);
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    const open = vi.fn();
    const planted = message(7, '<b>Pay now</b> [link](https://evil.example/)');
    const { api } = pollingApi(
      [
        { messages: [], latest: 6 },
        { messages: [planted], latest: 7 },
      ],
      [],
    );
    render(<Probe api={api} onOpenFeed={open} />);
    await tick(0);
    await tick(5_000);
    const [shown] = FakeNotification.shown;
    expect(shown!.title).toBe('<b>Pay now</b> [link](https://evil.example/)');
    expect(shown!.options).toEqual({ body: planted.text, tag: '7' });
    expect(open).not.toHaveBeenCalled();
    act(() => shown!.onclick?.());
    expect(focus).toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(shown!.closed).toBe(true);
  });

  it('shows nothing while the page is in front of the person', async () => {
    vi.useFakeTimers();
    stubNotification('granted');
    inFront(true);
    const { api } = pollingApi(
      [
        { messages: [], latest: 1 },
        { messages: [message(2)], latest: 2 },
      ],
      [],
    );
    render(<Probe api={api} onOpenFeed={() => undefined} />);
    await tick(0);
    await tick(5_000);
    expect(FakeNotification.shown).toEqual([]);
  });

  it('shows nothing unless the person allowed it, and does not throw without notifications', async () => {
    vi.useFakeTimers();
    inFront(false);
    for (const permission of ['default', 'denied'] as const) {
      stubNotification(permission);
      const { api, notifications } = pollingApi(
        [
          { messages: [], latest: 1 },
          { messages: [message(2)], latest: 2 },
        ],
        [],
      );
      render(<Probe api={api} onOpenFeed={() => undefined} />);
      await tick(0);
      await tick(5_000);
      expect(notifications).toHaveBeenCalledTimes(2);
      expect(FakeNotification.shown, permission).toEqual([]);
      cleanup();
    }
    vi.stubGlobal('Notification', undefined);
    const { api, notifications } = pollingApi(
      [
        { messages: [], latest: 1 },
        { messages: [message(2)], latest: 2 },
      ],
      [],
    );
    render(<Probe api={api} onOpenFeed={() => undefined} />);
    await tick(0);
    await tick(5_000);
    expect(notifications).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('waiting').textContent).toBe('0');
  });

  it('does not throw when the browser will not make a notification', async () => {
    vi.useFakeTimers();
    stubNotification('granted');
    inFront(false);
    vi.stubGlobal(
      'Notification',
      Object.assign(
        function Refusing() {
          throw new TypeError('Illegal constructor');
        },
        { permission: 'granted' },
      ),
    );
    const { api, notifications } = pollingApi(
      [
        { messages: [], latest: 1 },
        { messages: [message(2)], latest: 2 },
      ],
      [],
    );
    render(<Probe api={api} onOpenFeed={() => undefined} />);
    await tick(0);
    await tick(5_000);
    expect(notifications).toHaveBeenCalledTimes(2);
  });

  it('keeps asking after a poll fails, from the same place', async () => {
    vi.useFakeTimers();
    stubNotification('granted');
    inFront(false);
    const notifications = vi
      .fn()
      .mockResolvedValueOnce({ messages: [], latest: 3 })
      .mockRejectedValueOnce(new ApiError(500, 'Request failed (500)'))
      .mockResolvedValue({ messages: [message(4)], latest: 4 });
    const api = { notifications, feed: async () => [] } as unknown as IPersonalApi;
    render(<Probe api={api} onOpenFeed={() => undefined} />);
    await tick(0);
    await tick(5_000);
    await tick(5_000);
    expect(notifications.mock.calls.map((call) => call[0])).toEqual([undefined, 3, 3]);
    expect(FakeNotification.shown.map((shown) => shown.title)).toEqual(['Question 4']);
  });

  it('shows the number of waiting questions in the title, and nothing when none waits', async () => {
    vi.useFakeTimers();
    stubNotification('granted');
    inFront(true);
    document.title = 'Personal agent';
    const items: IFeedItemView[] = [
      card('a'),
      card('b'),
      card('c', 'answered'),
      card('d', 'withdrawn'),
      report,
    ];
    const { api } = pollingApi([{ messages: [], latest: 0 }], items);
    render(<Probe api={api} onOpenFeed={() => undefined} />);
    await tick(0);
    expect(document.title).toBe('(2) Personal agent');
    expect(screen.getByTestId('waiting').textContent).toBe('2');
    items.splice(0, items.length, card('a', 'answered'), report);
    await tick(5_000);
    expect(document.title).toBe('Personal agent');
    items.splice(0, items.length, card('e'));
    await tick(5_000);
    expect(document.title).toBe('(1) Personal agent');
    cleanup();
    expect(document.title).toBe('Personal agent');
  });

  it('keeps the count in front when something else names the tab afterwards, as the chat does for its folder', async () => {
    vi.useFakeTimers();
    stubNotification('granted');
    inFront(true);
    document.title = 'Personal agent';
    const { api } = pollingApi([{ messages: [], latest: 0 }], [card('a'), card('b')]);
    render(<Probe api={api} onOpenFeed={() => undefined} />);
    await tick(0);
    expect(document.title).toBe('(2) Personal agent');
    await act(async () => {
      document.title = 'workspace — Personal agent';
      await Promise.resolve();
    });
    expect(document.title).toBe('(2) workspace — Personal agent');
    cleanup();
    expect(document.title).toBe('workspace — Personal agent');
  });

  it('counts only the open question cards, and puts the count in front of the title', () => {
    expect(openQuestionCount([card('a'), card('b', 'answered'), report])).toBe(1);
    expect(openQuestionCount([report])).toBe(0);
    expect(titleWithCount('Personal agent', 0)).toBe('Personal agent');
    expect(titleWithCount('Personal agent', 12)).toBe('(12) Personal agent');
    expect(titleWithCount('(3) Personal agent', 1)).toBe('(1) Personal agent');
    expect(titleWithCount('(3) Personal agent', 0)).toBe('Personal agent');
  });
});
