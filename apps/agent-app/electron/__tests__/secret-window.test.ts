import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

type TListener = (...args: unknown[]) => void;
interface ITestWindow extends EventEmitter {
  readonly options: Record<string, unknown>;
  readonly webContents: EventEmitter & {
    readonly mainFrame: object;
    setWindowOpenHandler: ReturnType<typeof vi.fn>;
  };
  readonly loadFile: ReturnType<typeof vi.fn>;
  readonly show: ReturnType<typeof vi.fn>;
  isDestroyed(): boolean;
  destroy(): void;
}
const mocks = vi.hoisted(() => ({
  windows: [] as ITestWindow[],
  listeners: new Map<string, Set<TListener>>(),
  onCreate: undefined as ((window: ITestWindow) => void) | undefined,
  onSubscribe: undefined as ((channel: string) => void) | undefined,
}));
vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class Window extends Emitter {
    readonly webContents = Object.assign(new Emitter(), {
      mainFrame: {},
      setWindowOpenHandler: vi.fn(),
    });
    readonly loadFile = vi.fn(async () => {});
    readonly show = vi.fn();
    private destroyed = false;
    constructor(readonly options: Record<string, unknown>) {
      super();
      mocks.windows.push(this);
      mocks.onCreate?.(this);
    }
    isDestroyed(): boolean { return this.destroyed; }
    destroy(): void {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('closed');
    }
  }
  return {
    BrowserWindow: Window,
    ipcMain: {
      on: (channel: string, listener: TListener) => {
        mocks.onSubscribe?.(channel);
        const listeners = mocks.listeners.get(channel) ?? new Set<TListener>();
        listeners.add(listener);
        mocks.listeners.set(channel, listeners);
      },
      removeListener: (channel: string, listener: TListener) => {
        mocks.listeners.get(channel)?.delete(listener);
      },
    },
  };
});

import { openSecretWindow } from '../secret-window.js';

function send(channel: string, sender: object, senderFrame: object, value?: unknown): void {
  for (const listener of [...(mocks.listeners.get(channel) ?? [])]) {
    listener({ sender, senderFrame }, value);
  }
}
function activeWindow(): ITestWindow {
  const window = mocks.windows.at(-1);
  if (!window) throw new Error('The secret window was not created.');
  return window;
}
const parent = Object.assign(new EventEmitter(), { isDestroyed: () => false }) as BrowserWindow;

beforeEach(() => {
  mocks.windows.length = 0;
  mocks.listeners.clear();
  mocks.onCreate = undefined;
  mocks.onSubscribe = undefined;
});

describe('desktop owner secret window', () => {
  it('accepts a credential only from its own top frame and removes its IPC handlers', async () => {
    const result = openSecretWindow(parent);
    const window = activeWindow();
    const options = window.options['webPreferences'];
    expect(options).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false });
    expect(window.options).toMatchObject({ modal: true, parent, show: false });
    let settled = false;
    void result.then(() => { settled = true; });
    send('desktop-secret:submit', {}, window.webContents.mainFrame, { type: 'passphrase', value: 'wrong-sender' });
    send('desktop-secret:submit', window.webContents, {}, { type: 'passphrase', value: 'wrong-frame' });
    send('desktop-secret:submit', window.webContents, window.webContents.mainFrame, { type: 'other', value: 'invalid' });
    await Promise.resolve();
    expect(settled).toBe(false);
    send('desktop-secret:submit', window.webContents, window.webContents.mainFrame, { type: 'passphrase', value: 'only-from-secret-window' });
    await expect(result).resolves.toEqual({ type: 'passphrase', value: 'only-from-secret-window' });
    expect(window.isDestroyed()).toBe(true);
    expect([...mocks.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  });

  it('supports a recovery key, and cancelling or closing returns no credential', async () => {
    const recover = openSecretWindow(parent);
    const first = activeWindow();
    send('desktop-secret:submit', first.webContents, first.webContents.mainFrame, { type: 'recovery', value: 'recovery-key' });
    await expect(recover).resolves.toEqual({ type: 'recovery', value: 'recovery-key' });

    const cancel = openSecretWindow(parent);
    const second = activeWindow();
    send('desktop-secret:cancel', second.webContents, second.webContents.mainFrame);
    await expect(cancel).resolves.toBeUndefined();

    const closed = openSecretWindow(parent);
    activeWindow().destroy();
    await expect(closed).resolves.toBeUndefined();
  });

  it('cancels if its parent closes and denies navigation and new windows', async () => {
    const otherParent = Object.assign(new EventEmitter(), { isDestroyed: () => false }) as BrowserWindow;
    const result = openSecretWindow(otherParent);
    const window = activeWindow();
    const deny = window.webContents.setWindowOpenHandler.mock.calls[0]?.[0];
    expect(deny()).toEqual({ action: 'deny' });
    const preventDefault = vi.fn();
    window.webContents.emit('will-navigate', { preventDefault });
    window.webContents.emit('will-redirect', { preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(2);
    otherParent.emit('closed');
    await expect(result).resolves.toBeUndefined();
    expect(window.isDestroyed()).toBe(true);
  });

  it('refuses a second concurrent prompt, rejects malformed values and leaves no stale listener', async () => {
    const result = openSecretWindow(parent);
    const window = activeWindow();
    await expect(openSecretWindow(parent)).rejects.toThrow(/already open/i);
    send('desktop-secret:submit', window.webContents, window.webContents.mainFrame, { type: 'passphrase', value: '' });
    send('desktop-secret:submit', window.webContents, window.webContents.mainFrame, { type: 'passphrase', value: 42 });
    send('desktop-secret:cancel', window.webContents, window.webContents.mainFrame);
    await expect(result).resolves.toBeUndefined();
    expect([...mocks.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  });

  it('cancels on owner revocation and refuses an already revoked request', async () => {
    const controller = new AbortController();
    const result = openSecretWindow(parent, controller.signal);
    const window = activeWindow();
    controller.abort();
    await expect(result).resolves.toBeUndefined();
    expect(window.isDestroyed()).toBe(true);
    expect([...mocks.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    const count = mocks.windows.length;
    await expect(openSecretWindow(parent, controller.signal)).resolves.toBeUndefined();
    expect(mocks.windows.length).toBe(count);
  });
  it('closes the prompt if cancellation happens while the window is being created', async () => {
    const controller = new AbortController();
    mocks.onCreate = () => controller.abort();
    const result = openSecretWindow(parent, controller.signal);
    const window = activeWindow();
    const outcome = await Promise.race([
      result.then(() => 'cancelled'),
      new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 25)),
    ]);
    if (!window.isDestroyed()) window.destroy();
    await result;
    expect(outcome).toBe('cancelled');
    expect(window.loadFile).not.toHaveBeenCalled();
    expect([...mocks.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  });

  it('closes the prompt if its parent closes while the window is being created', async () => {
    let closed = false;
    const otherParent = Object.assign(new EventEmitter(), { isDestroyed: () => closed }) as BrowserWindow;
    mocks.onCreate = () => { closed = true; otherParent.emit('closed'); };
    const result = openSecretWindow(otherParent);
    const window = activeWindow();
    const outcome = await Promise.race([
      result.then(() => 'cancelled'),
      new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 25)),
    ]);
    if (!window.isDestroyed()) window.destroy();
    await result;
    expect(outcome).toBe('cancelled');
    expect(window.loadFile).not.toHaveBeenCalled();
    expect([...mocks.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  });

  it.each(['desktop-secret:submit', 'desktop-secret:cancel'])('removes listeners if cancellation happens while registering %s', async (channel) => {
    const controller = new AbortController();
    mocks.onSubscribe = (name) => { if (name === channel) controller.abort(); };
    const result = openSecretWindow(parent, controller.signal);
    const window = activeWindow();
    await expect(result).resolves.toBeUndefined();
    expect(window.isDestroyed()).toBe(true);
    expect(window.loadFile).not.toHaveBeenCalled();
    expect([...mocks.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  });

  it('cancels if the prompt closes before its close listener is registered', async () => {
    mocks.onCreate = (window) => window.destroy();
    const result = openSecretWindow(parent);
    const window = activeWindow();
    const outcome = await Promise.race([
      result.then(() => 'cancelled'),
      new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 25)),
    ]);
    if (outcome === 'pending') parent.emit('closed');
    await result;
    expect(outcome).toBe('cancelled');
    expect(window.loadFile).not.toHaveBeenCalled();
    expect([...mocks.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  });

  it('does not release a newer prompt when cancellation reenters during listener registration', async () => {
    const controller = new AbortController();
    let second: ReturnType<typeof openSecretWindow> | undefined;
    mocks.onSubscribe = (channel) => {
      if (channel !== 'desktop-secret:submit') return;
      mocks.onSubscribe = undefined;
      controller.signal.addEventListener('abort', () => { second = openSecretWindow(parent); }, { once: true });
      controller.abort();
    };
    const first = openSecretWindow(parent, controller.signal);
    expect(mocks.windows).toHaveLength(2);
    const secondWindow = mocks.windows[1];
    if (!second || !secondWindow) throw new Error('Expected the second prompt.');
    const third = openSecretWindow(parent).then(() => false, () => true);
    const thirdWindow = mocks.windows[2];
    thirdWindow?.destroy();
    const rejected = await third;
    send('desktop-secret:cancel', secondWindow.webContents, secondWindow.webContents.mainFrame);
    await first;
    await second;
    expect(rejected).toBe(true);
    expect(mocks.windows).toHaveLength(2);
  });

});
