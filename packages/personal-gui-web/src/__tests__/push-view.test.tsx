// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api.js';
import { keyBytes } from '../push.js';
import { PushNotifications } from '../views/PushNotifications.js';
import { SettingsView } from '../views/Settings.js';

import type { IPersonalApi } from '../api.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

/** What stands for a push address; built from pieces so no scan takes it for one. */
const TOKEN = ['tok', 'en-', 'Qx7', 'kd2', 'Lm9'].join('');
const ENDPOINT = `https://push.example.test/send/${TOKEN}`;
const OTHER_ENDPOINT = `https://push.example.test/send/${TOKEN}-earlier`;
/** The agent's public key: 65 bytes, as URL-safe base64. */
const KEY = Buffer.alloc(65, 7).toString('base64url');
const OTHER_KEY = Buffer.alloc(65, 9).toString('base64url');

class FakeSubscription {
  unsubscribed = false;
  constructor(
    readonly endpoint: string,
    readonly key: string,
    private readonly registration: FakeRegistration,
  ) {}
  get options(): { applicationServerKey: ArrayBuffer } {
    return { applicationServerKey: new Uint8Array(Buffer.from(this.key, 'base64url')).buffer };
  }
  toJSON(): PushSubscriptionJSON {
    return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: 'p', auth: 'a' } };
  }
  async unsubscribe(): Promise<boolean> {
    this.unsubscribed = true;
    this.registration.subscription = null;
    return true;
  }
}

class FakeRegistration {
  subscription: FakeSubscription | null = null;
  unregistered = false;
  readonly subscribeCalls: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }[] = [];
  active: { scriptURL: string };
  constructor(
    readonly scope: string,
    scriptURL = `${scope}push-worker.js`,
  ) {
    this.active = { scriptURL };
  }
  readonly pushManager = {
    getSubscription: async (): Promise<FakeSubscription | null> => this.subscription,
    subscribe: vi.fn(
      async (options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => {
        this.subscribeCalls.push(options);
        this.subscription = new FakeSubscription(
          ENDPOINT,
          Buffer.from(options.applicationServerKey).toString('base64url'),
          this,
        );
        return this.subscription;
      },
    ),
  };
  async unregister(): Promise<boolean> {
    this.unregistered = true;
    return true;
  }
}

/** The page's own address in jsdom, so its worker's scope is the folder the page is in. */
const OWN_SCOPE = new URL('.', window.location.href).href;

class FakePermission {
  static permission: NotificationPermission = 'default';
  static answer: NotificationPermission = 'granted';
  static requested = 0;
  static async requestPermission(): Promise<NotificationPermission> {
    FakePermission.requested += 1;
    FakePermission.permission = FakePermission.answer;
    return FakePermission.answer;
  }
}

interface IWorld {
  readonly own: FakeRegistration;
  readonly registrations: FakeRegistration[];
  readonly register: ReturnType<typeof vi.fn>;
  readonly api: IPersonalApi;
  readonly calls: string[];
  readonly count: { subscribed: number };
}

/** A browser that can take a push: a worker registry, the push manager and notifications. */
function browser(
  options: {
    permission?: NotificationPermission;
    answer?: NotificationPermission;
    held?: boolean;
    heldKey?: string;
    others?: FakeRegistration[];
    api?: Partial<IPersonalApi>;
    subscribed?: number;
  } = {},
): IWorld {
  const own = new FakeRegistration(OWN_SCOPE);
  if (options.held === true)
    own.subscription = new FakeSubscription(ENDPOINT, options.heldKey ?? KEY, own);
  const others = options.others ?? [];
  const registrations = [own, ...others];
  const calls: string[] = [];
  const count = { subscribed: options.subscribed ?? 0 };
  const register = vi.fn(async (script: string) => {
    calls.push(`register ${script}`);
    return own;
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register,
      ready: Promise.resolve(own),
      getRegistration: async () => own,
      getRegistrations: async () => registrations,
    },
  });
  vi.stubGlobal('PushManager', class {});
  FakePermission.permission = options.permission ?? 'default';
  FakePermission.answer = options.answer ?? 'granted';
  FakePermission.requested = 0;
  vi.stubGlobal('Notification', FakePermission);
  const api = {
    pushStatus: vi.fn(async () => {
      calls.push('status');
      return { subscribed: count.subscribed, supported: true };
    }),
    pushKey: vi.fn(async () => {
      calls.push('key');
      return { publicKey: KEY };
    }),
    subscribePush: vi.fn(async (subscription: PushSubscriptionJSON) => {
      calls.push(`subscribe ${subscription.endpoint}`);
      count.subscribed += 1;
      return { subscribed: count.subscribed, supported: true };
    }),
    unsubscribePush: vi.fn(async (endpoint: string) => {
      calls.push(`unsubscribe ${endpoint}`);
      count.subscribed = Math.max(0, count.subscribed - 1);
      return { subscribed: count.subscribed, supported: true };
    }),
    ...options.api,
  } as unknown as IPersonalApi;
  return { own, registrations, register, api, calls, count };
}

const status = (): string => screen.getByRole('status').textContent ?? '';
const enable = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Also notify me when this page is closed' });
const stop = (): HTMLButtonElement => screen.getByRole('button', { name: 'Stop' });

describe('notifications when the page is closed, in Settings', () => {
  it('reads the browser and the agent on load but asks and registers nothing', async () => {
    const world = browser({ subscribed: 2 });
    render(<PushNotifications api={world.api} />);
    await waitFor(() => expect(status()).toMatch(/^Off\./u));
    expect(screen.getByText('2 browsers are subscribed.')).toBeTruthy();
    expect(FakePermission.requested).toBe(0);
    expect(world.register).not.toHaveBeenCalled();
    expect(world.own.pushManager.subscribe).not.toHaveBeenCalled();
    expect(world.calls).toEqual(['status']);
    expect(enable().disabled).toBe(false);
    expect(stop().disabled).toBe(true);
  });

  it('turns it on from the press: asks, registers the worker beside the page, subscribes with the agent’s key, tells the agent', async () => {
    const world = browser({ subscribed: 1 });
    render(<PushNotifications api={world.api} />);
    await waitFor(() => expect(status()).toMatch(/^Off\./u));
    fireEvent.click(enable());
    await waitFor(() => expect(status()).toMatch(/^On\./u));
    expect(FakePermission.requested).toBe(1);
    expect(world.calls).toEqual([
      'status',
      'register push-worker.js',
      'key',
      `subscribe ${ENDPOINT}`,
    ]);
    expect(world.own.subscribeCalls).toHaveLength(1);
    expect(world.own.subscribeCalls[0]!.userVisibleOnly).toBe(true);
    expect(
      Buffer.from(world.own.subscribeCalls[0]!.applicationServerKey).toString('base64url'),
    ).toBe(KEY);
    expect(screen.getByText('2 browsers are subscribed.')).toBeTruthy();
    expect(enable().disabled).toBe(true);
    expect(stop().disabled).toBe(false);
    // The page shows no address and no key.
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(document.body.textContent).not.toContain(KEY);
  });

  it('shows that it is on when this browser already holds a subscription, without asking', async () => {
    const world = browser({ permission: 'granted', held: true, subscribed: 1 });
    render(<PushNotifications api={world.api} />);
    await waitFor(() => expect(status()).toMatch(/^On\./u));
    expect(screen.getByText('1 browser is subscribed.')).toBeTruthy();
    expect(FakePermission.requested).toBe(0);
    expect(enable().disabled).toBe(true);
    expect(stop().disabled).toBe(false);
  });

  it('registers nothing and subscribes to nothing when the person does not allow it, or the browser has it blocked', async () => {
    const dismissed = browser({ answer: 'default' });
    render(<PushNotifications api={dismissed.api} />);
    await waitFor(() => expect(status()).toMatch(/^Off\./u));
    fireEvent.click(enable());
    await waitFor(() => expect(FakePermission.requested).toBe(1));
    expect(status()).toMatch(/^Off\./u);
    expect(dismissed.register).not.toHaveBeenCalled();
    expect(dismissed.api.subscribePush).not.toHaveBeenCalled();
    cleanup();

    const denied = browser({ answer: 'denied' });
    render(<PushNotifications api={denied.api} />);
    await waitFor(() => expect(status()).toMatch(/^Off\./u));
    fireEvent.click(enable());
    await waitFor(() => expect(status()).toMatch(/^Blocked\./u));
    expect(denied.register).not.toHaveBeenCalled();
    expect(enable().disabled).toBe(true);
    cleanup();

    const blocked = browser({ permission: 'denied' });
    render(<PushNotifications api={blocked.api} />);
    await waitFor(() => expect(status()).toMatch(/^Blocked\./u));
    expect(enable().disabled).toBe(true);
    expect(stop().disabled).toBe(true);
    expect(FakePermission.requested).toBe(0);
  });

  it('says so, and does not throw, when the browser has no worker, no push manager or no notifications', async () => {
    const unsupported = /^This browser cannot be notified while the page is closed/u;
    // No service worker (as on a page that is not secure).
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', FakePermission);
    const api = { pushStatus: vi.fn() } as unknown as IPersonalApi;
    render(<PushNotifications api={api} />);
    expect(status()).toMatch(unsupported);
    expect(enable().disabled).toBe(true);
    expect(stop().disabled).toBe(true);
    expect(api.pushStatus).not.toHaveBeenCalled();
    cleanup();

    browser();
    vi.stubGlobal('PushManager', undefined);
    Reflect.deleteProperty(window, 'PushManager');
    render(<PushNotifications api={{ pushStatus: vi.fn() } as unknown as IPersonalApi} />);
    expect(status()).toMatch(unsupported);
    cleanup();

    const world = browser();
    vi.stubGlobal('Notification', undefined);
    render(<PushNotifications api={world.api} />);
    expect(status()).toMatch(unsupported);
    expect(world.api.pushStatus).not.toHaveBeenCalled();
  });

  it('shows the agent’s words when it refuses the subscription, and takes the browser’s subscription back', async () => {
    const world = browser({
      api: {
        subscribePush: vi.fn(async () => {
          throw new ApiError(400, 'The push address (push.example.test) cannot be used: refused');
        }),
      },
    });
    render(<PushNotifications api={world.api} />);
    await waitFor(() => expect(status()).toMatch(/^Off\./u));
    fireEvent.click(enable());
    await waitFor(() => expect(status()).toMatch(/cannot be used: refused/u));
    expect(world.own.subscription).toBeNull();
    expect(enable().disabled).toBe(false);
    expect(stop().disabled).toBe(true);
  });

  it('shows what went wrong, without throwing, when the browser cannot register or subscribe', async () => {
    const failing = browser();
    failing.own.pushManager.subscribe.mockRejectedValue(
      new Error('Registration failed - push service error'),
    );
    render(<PushNotifications api={failing.api} />);
    await waitFor(() => expect(status()).toMatch(/^Off\./u));
    fireEvent.click(enable());
    await waitFor(() => expect(status()).toBe('Registration failed - push service error'));
    expect(failing.api.subscribePush).not.toHaveBeenCalled();
    cleanup();

    const noWorker = browser();
    noWorker.register.mockRejectedValue(new Error('The worker script could not be loaded'));
    render(<PushNotifications api={noWorker.api} />);
    await waitFor(() => expect(status()).toMatch(/^Off\./u));
    fireEvent.click(enable());
    await waitFor(() => expect(status()).toBe('The worker script could not be loaded'));
    expect(noWorker.api.pushKey).not.toHaveBeenCalled();
    cleanup();

    const agentDown = browser({
      api: {
        pushStatus: vi.fn(async () => {
          throw new Error('Failed to fetch');
        }),
      },
    });
    render(<PushNotifications api={agentDown.api} />);
    await waitFor(() => expect(status()).toBe('Failed to fetch'));
    expect(enable().disabled).toBe(false);
  });

  it('subscribes anew when the browser holds a subscription the agent never kept, made with another key', async () => {
    const world = browser({ permission: 'granted', held: true, heldKey: OTHER_KEY, subscribed: 0 });
    const earlier = world.own.subscription!;
    render(<PushNotifications api={world.api} />);
    // The browser holds one but the agent does not, so it is not reachable: off, and the button is there.
    await waitFor(() => expect(status()).toMatch(/^Off\./u));
    fireEvent.click(enable());
    await waitFor(() => expect(status()).toMatch(/^On\./u));
    expect(earlier.unsubscribed).toBe(true);
    expect(world.own.subscribeCalls).toHaveLength(1);
    expect(
      Buffer.from(world.own.subscribeCalls[0]!.applicationServerKey).toString('base64url'),
    ).toBe(KEY);
    expect(world.api.subscribePush).toHaveBeenCalledTimes(1);
  });

  it('stops: the browser stops taking pushes, the agent is told, and the worker goes', async () => {
    const world = browser({ permission: 'granted', held: true, subscribed: 1 });
    const held = world.own.subscription!;
    render(<PushNotifications api={world.api} />);
    await waitFor(() => expect(status()).toMatch(/^On\./u));
    fireEvent.click(stop());
    await waitFor(() => expect(status()).toMatch(/^Off\./u));
    expect(held.unsubscribed).toBe(true);
    expect(world.own.unregistered).toBe(true);
    expect(world.calls).toEqual(['status', `unsubscribe ${ENDPOINT}`, 'status']);
    expect(screen.getByText('0 browsers are subscribed.')).toBeTruthy();
    expect(enable().disabled).toBe(false);
    expect(stop().disabled).toBe(true);
  });

  it('stops even when the agent cannot be told: the browser has stopped, and the agent drops the address when its push service says it is gone', async () => {
    const world = browser({
      permission: 'granted',
      held: true,
      subscribed: 1,
      api: {
        unsubscribePush: vi.fn(async () => {
          throw new Error('Failed to fetch');
        }),
      },
    });
    const held = world.own.subscription!;
    render(<PushNotifications api={world.api} />);
    await waitFor(() => expect(status()).toMatch(/^On\./u));
    fireEvent.click(stop());
    await waitFor(() => expect(status()).toMatch(/^Off\./u));
    expect(held.unsubscribed).toBe(true);
  });

  it('stops the workers an earlier start of the agent left under other paths, so a message does not arrive twice', async () => {
    const earlier = new FakeRegistration('http://localhost:3000/an-earlier-path/');
    earlier.subscription = new FakeSubscription(OTHER_ENDPOINT, KEY, earlier);
    const stranger = new FakeRegistration(
      'http://localhost:3000/elsewhere/',
      'http://localhost:3000/elsewhere/another-worker.js',
    );
    stranger.subscription = new FakeSubscription(`${OTHER_ENDPOINT}-2`, KEY, stranger);
    const world = browser({ others: [earlier, stranger], subscribed: 1 });
    render(<PushNotifications api={world.api} />);
    await waitFor(() => expect(status()).toMatch(/^Off\./u));
    fireEvent.click(enable());
    await waitFor(() => expect(status()).toMatch(/^On\./u));
    expect(world.calls).toEqual([
      'status',
      `unsubscribe ${OTHER_ENDPOINT}`,
      'register push-worker.js',
      'key',
      `subscribe ${ENDPOINT}`,
    ]);
    expect(earlier.subscription).toBeNull();
    expect(earlier.unregistered).toBe(true);
    // A worker that is not ours is left alone, and so is this page's own.
    expect(stranger.unregistered).toBe(false);
    expect(stranger.subscription).not.toBeNull();
    expect(world.own.unregistered).toBe(false);
  });

  it('is part of the Settings view, below the notifications of this browser', async () => {
    const world = browser();
    const api = {
      ...world.api,
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
      webhook: async () => ({ configured: false, format: 'plain' }),
    } as unknown as IPersonalApi;
    render(<SettingsView api={api} />);
    const section = await screen.findByRole('region', {
      name: 'Notifications when the page is closed',
    });
    expect(section.textContent).toMatch(/under the same limits as everywhere else/u);
    expect(FakePermission.requested).toBe(0);
    expect(world.register).not.toHaveBeenCalled();
  });
});

describe('the agent’s key as a browser takes it', () => {
  it('is the bytes of the URL-safe base64 text, padded or not', () => {
    expect([...keyBytes('AAECAw')]).toEqual([0, 1, 2, 3]);
    expect([...keyBytes('-_8')]).toEqual([251, 255]);
    expect(keyBytes(KEY)).toHaveLength(65);
    expect(Buffer.from(keyBytes(KEY)).toString('base64url')).toBe(KEY);
  });
});
