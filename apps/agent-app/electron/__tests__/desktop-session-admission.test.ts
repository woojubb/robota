import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { IpcMain, MessageChannelMain, WebContents } from 'electron';

import { registerDesktopSessionAdmission } from '../desktop-session-admission.js';

const relay = vi.hoisted(() => ({ open: vi.fn((_options: { onClosed: () => void }) => ({ dispose: vi.fn() })) }));
vi.mock('../desktop-session-relay.js', () => ({ openDesktopSessionRelay: relay.open }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(beforeRegistration?: (ipc: EventEmitter, sender: EventEmitter) => void) {
  relay.open.mockClear();
  const ipc = new EventEmitter();
  const frame = { postMessage: vi.fn(), send: vi.fn() };
  const sender = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false });
  beforeRegistration?.(ipc, sender);
  const closed = deferred<void>();
  const channel = { send: vi.fn(), onMessage: vi.fn(() => () => {}) };
  const link = {
    standing: 'owner' as const, binding: { runtimeId: 'r', generation: 'g' },
    custody: { certified: true, unlocked: false }, closed: closed.promise, session: channel,
    onCustody: vi.fn(() => () => {}), close: vi.fn(), lock: vi.fn(async () => {}),
    unlock: vi.fn(async () => 'verified' as const),
    control: vi.fn(async (request: { command: string }): Promise<Readonly<Record<string, unknown>>> =>
      request.command === 'status' ? { status: 'running', daemon: true, cwd: '/fixture' } : { status: 'attached', driverId: 'd' }),
  };
  const release = vi.fn();
  const requestSecret = vi.fn(async () => ({ type: 'passphrase' as const, value: 'synthetic' }));
  const openOwner = vi.fn(async () => ({ link, release, selected: { runtimeId: 'r', generation: 'g' } }));
  const onUnconfirmed = vi.fn();
  const admission = registerDesktopSessionAdmission({
    sender: sender as unknown as WebContents, ipc: ipc as unknown as IpcMain, isCurrent: () => true,
    expected: { workspace: '/fixture', restricted: false },
    requestSecret, openOwner, onUnconfirmed, createChannel: () => ({ port1: {}, port2: {} }) as unknown as MessageChannelMain,
  });
  const event = { sender, senderFrame: frame, ports: [] };
  const request = (value: unknown = event, ...extra: unknown[]) => ipc.emit('desktop-session:request', value, ...extra);
  return { ipc, sender, frame, event, request, admission, requestSecret, openOwner, link, release, onUnconfirmed, closeLink: () => closed.resolve() };
}

describe('desktop session admission', () => {
  it('does not prompt or open an owner merely because a renderer requests a port', async () => {
    const s = setup();
    expect(s.frame.send).toHaveBeenCalledWith('desktop-session:request-ready');
    expect((await s.admission.openFromNativeAction()).kind).toBe('not-ready');
    s.request();
    expect(s.requestSecret).not.toHaveBeenCalled();
    expect(s.openOwner).not.toHaveBeenCalled();
    expect(relay.open).not.toHaveBeenCalled();
    const result = await s.admission.openFromNativeAction();
    expect(result.kind).toBe('open');
    expect(s.requestSecret).toHaveBeenCalledOnce();
    expect(s.openOwner).toHaveBeenCalledOnce();
    expect(relay.open).toHaveBeenCalledOnce();
    if (result.kind === 'open') await result.close();
    await s.admission.dispose();
  });

  it('accepts a main-frame send event without a ports property', async () => {
    const s = setup();
    s.request({ sender: s.sender, senderFrame: s.frame });
    const result = await s.admission.openFromNativeAction();
    expect(result.kind).toBe('open');
    if (result.kind === 'open') await result.close();
    await s.admission.dispose();
  });

  it('refuses foreign windows, child frames, extra payload and transferred ports', async () => {
    const s = setup();
    s.request({ ...s.event, sender: new EventEmitter() });
    s.request({ ...s.event, senderFrame: {} });
    s.request(s.event, 'unexpected');
    const port = { close: vi.fn() };
    s.request({ ...s.event, ports: [port] });
    expect(port.close).toHaveBeenCalledOnce();
    expect((await s.admission.openFromNativeAction()).kind).toBe('not-ready');
    expect(s.requestSecret).not.toHaveBeenCalled();
    expect(relay.open).not.toHaveBeenCalled();
    await s.admission.dispose();
  });

  it('does not reuse a request after main-frame navigation or destruction', async () => {
    const s = setup();
    s.request();
    s.sender.emit('did-start-navigation', { isMainFrame: true });
    expect((await s.admission.openFromNativeAction()).kind).toBe('not-ready');
    expect(s.requestSecret).not.toHaveBeenCalled();
    await s.admission.dispose();
    expect(s.ipc.listenerCount('desktop-session:request')).toBe(0);
  });

  it('aborts an in-flight grant and never transfers a port on navigation', async () => {
    const s = setup();
    const pending = deferred<'verified'>();
    s.link.unlock.mockReturnValueOnce(pending.promise);
    s.request();
    const opening = s.admission.openFromNativeAction();
    await vi.waitFor(() => expect(s.link.unlock).toHaveBeenCalledOnce());
    s.sender.emit('did-start-navigation', { isMainFrame: true });
    expect((await opening).kind).toBe('lock-unconfirmed');
    expect(s.link.lock).toHaveBeenCalledWith('explicit');
    expect(s.link.close).toHaveBeenCalledOnce();
    expect(s.release).toHaveBeenCalledOnce();
    pending.resolve('verified');
    await Promise.resolve();
    expect(relay.open).not.toHaveBeenCalled();
    await expect(s.admission.dispose()).rejects.toThrow('The runtime lock could not be confirmed.');
    expect(s.onUnconfirmed).toHaveBeenCalledOnce();
  });

  it('does not process further requests after disposal', async () => {
    const s = setup();
    await s.admission.dispose();
    s.request();
    expect((await s.admission.openFromNativeAction()).kind).toBe('not-ready');
    expect(s.ipc.listenerCount('desktop-session:request')).toBe(0);
    expect(s.requestSecret).not.toHaveBeenCalled();
  });
  it('removes listeners when the renderer is destroyed during registration', async () => {
    const s = setup((_ipc, sender) => {
      sender.on('newListener', (name) => {
        if (name === 'render-process-gone') sender.emit('destroyed');
      });
    });
    expect((await s.admission.openFromNativeAction()).kind).toBe('not-ready');
    expect(s.ipc.listenerCount('desktop-session:request')).toBe(0);
    expect(s.sender.listenerCount('destroyed')).toBe(0);
    expect(s.sender.listenerCount('render-process-gone')).toBe(0);
    expect(s.sender.listenerCount('did-start-navigation')).toBe(0);
    await s.admission.dispose();
  });

  it('reports an unconfirmed lock after the owner link closes', async () => {
    const s = setup();
    s.request();
    expect((await s.admission.openFromNativeAction()).kind).toBe('open');
    s.link.lock.mockRejectedValueOnce(new Error('connection lost'));
    s.closeLink();
    await vi.waitFor(() => expect(s.onUnconfirmed).toHaveBeenCalledOnce());
    await expect(s.admission.dispose()).rejects.toThrow('The runtime lock could not be confirmed.');
    expect(s.ipc.listenerCount('desktop-session:request')).toBe(0);
  });

  it('continues disposal when a listener removal throws', async () => {
    const s = setup();
    s.sender.once('removeListener', () => { throw new Error('fixture removal failure'); });
    await expect(s.admission.dispose()).rejects.toThrow('fixture removal failure');
    expect(s.ipc.listenerCount('desktop-session:request')).toBe(0);
    expect(s.sender.listenerCount('render-process-gone')).toBe(0);
    expect(s.sender.listenerCount('did-start-navigation')).toBe(0);
    expect((await s.admission.openFromNativeAction()).kind).toBe('not-ready');
  });

  it('locks and releases the owner when the relay closes', async () => {
    const s = setup();
    s.request();
    expect((await s.admission.openFromNativeAction()).kind).toBe('open');
    relay.open.mock.calls[0]?.[0].onClosed();
    await s.admission.dispose();
    expect(s.link.lock).toHaveBeenCalledOnce();
    expect(s.link.close).toHaveBeenCalledOnce();
    expect(s.release).toHaveBeenCalledOnce();
    expect((await s.admission.openFromNativeAction()).kind).toBe('not-ready');
  });

  it('reports an unconfirmed lock after the relay closes', async () => {
    const s = setup();
    s.request();
    expect((await s.admission.openFromNativeAction()).kind).toBe('open');
    s.link.lock.mockRejectedValueOnce(new Error('lock failed'));
    relay.open.mock.calls[0]?.[0].onClosed();
    await expect(s.admission.dispose()).rejects.toThrow('The runtime lock could not be confirmed.');
    expect(s.onUnconfirmed).toHaveBeenCalledOnce();
    expect(s.link.close).toHaveBeenCalledOnce();
    expect(s.release).toHaveBeenCalledOnce();
  });

  it('revokes an owner if the relay closes during its initialization', async () => {
    const s = setup();
    relay.open.mockImplementationOnce((options) => {
      options.onClosed();
      return { dispose: vi.fn() };
    });
    s.request();
    expect((await s.admission.openFromNativeAction()).kind).toBe('cancelled');
    await s.admission.dispose();
    expect(s.link.lock).toHaveBeenCalledOnce();
    expect(s.link.close).toHaveBeenCalledOnce();
    expect(s.release).toHaveBeenCalledOnce();
    expect((await s.admission.openFromNativeAction()).kind).toBe('not-ready');
  });

  it('handles reentrant relay notification during owner close', async () => {
    const s = setup();
    relay.open.mockImplementationOnce((options) => ({ dispose: vi.fn(options.onClosed) }));
    s.request();
    const result = await s.admission.openFromNativeAction();
    expect(result.kind).toBe('open');
    if (result.kind !== 'open') return;
    await result.close();
    await s.admission.dispose();
    expect(s.link.lock).toHaveBeenCalledOnce();
    expect(s.link.close).toHaveBeenCalledOnce();
    expect(s.release).toHaveBeenCalledOnce();
    expect(s.onUnconfirmed).not.toHaveBeenCalled();
  });

});
