import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { IpcMain, MessageChannelMain, WebContents } from 'electron';
import type { TServerMessage } from '@robota-sdk/agent-transport';

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
  const channelListeners = new Set<(message: TServerMessage) => void>();
  const channel = { send: vi.fn(), onMessage: vi.fn((listener: (message: TServerMessage) => void) => {
    channelListeners.add(listener);
    return () => { channelListeners.delete(listener); };
  }) };
  const link = {
    standing: 'owner' as const, binding: { runtimeId: 'r', generation: 'g' },
    custody: { certified: true, unlocked: false }, closed: closed.promise, session: channel,
    onCustody: vi.fn(() => () => {}), close: vi.fn(() => closed.resolve()),
    lock: vi.fn(async (_reason: 'explicit' | 'screen-lock' | 'suspend' | 'fault') => {}),
    revokeToCleanup: vi.fn(),
    unlock: vi.fn(async () => 'verified' as const),
    question: vi.fn(async () => ({ kind: 'open' } as
      | { kind: 'open' }
      | { kind: 'accept'; digest: string; questionId: string; notice: string; question: string })),
    cancelQuestion: vi.fn(async () => {}),
    openAccepted: vi.fn(async () => {}),
    control: vi.fn(async (request: { command: string }): Promise<Readonly<Record<string, unknown>>> =>
      request.command === 'status' ? { status: 'running', daemon: true, cwd: '/fixture' } :
        request.command === 'owner-detach' ? { status: 'detached' } : { status: 'attached', driverId: 'd' }),
  };
  const release = vi.fn();
  const requestSecret = vi.fn(async () => ({ type: 'passphrase' as const, value: 'synthetic' }));
  const openOwner = vi.fn(async () => ({ link, release, selected: { runtimeId: 'r', generation: 'g' } }));
  const onUnconfirmed = vi.fn();
  const onDisposed = vi.fn();
  const admission = registerDesktopSessionAdmission({
    sender: sender as unknown as WebContents, ipc: ipc as unknown as IpcMain, isCurrent: () => true,
    expected: { workspace: '/fixture', restricted: false },
    requestSecret, openOwner, onUnconfirmed, onDisposed,
    createChannel: () => ({ port1: {}, port2: {} }) as unknown as MessageChannelMain,
  });
  const event = { sender, senderFrame: frame, ports: [] };
  const request = (value: unknown = event, ...extra: unknown[]) => ipc.emit('desktop-session:request', value, ...extra);
  return { ipc, sender, frame, event, request, admission, requestSecret, openOwner, link, release, onUnconfirmed, onDisposed,
    sendRuntime: (message: TServerMessage) => { for (const listener of channelListeners) listener(message); },
    closeLink: () => closed.resolve() };
}

describe('desktop session admission', () => {
  it('lets only a native owner action list and accept an unverified stored conversation', async () => {
    const s = setup();
    s.request();
    expect(() => s.admission.listUnverifiedFromNativeAction()).toThrow('unavailable');
    expect((await s.admission.openFromNativeAction()).kind).toBe('open');
    const listing = s.admission.listUnverifiedFromNativeAction();
    const requestId = s.link.session.send.mock.calls.at(-1)?.[0].requestId as string;
    s.sendRuntime({ type: 'sessions', requestId, listing: {
      currentSessionId: 'current', unreadableSessionIds: [], sessions: [
        { id: 'unverified', cwd: '/fixture', updatedAt: '2026-11-07', messageCount: 0, preview: '', authorship: 'unverified' },
        { id: 'verified', cwd: '/fixture', updatedAt: '2026-11-07', messageCount: 0, preview: '', authorship: 'verified' },
      ],
    } });
    expect(await listing).toEqual(['unverified']);
    s.link.question.mockResolvedValueOnce({ kind: 'accept', digest: 'a'.repeat(64), questionId: 'q', notice: 'Review', question: 'Accept?' });
    expect((await s.admission.questionFromNativeAction('unverified')).kind).toBe('accept');
    await s.admission.acceptFromNativeAction('unverified', 'a'.repeat(64), 'q');
    expect(s.link.openAccepted).toHaveBeenCalledExactlyOnceWith('d', 'unverified', 'a'.repeat(64), 'q');
    await s.admission.dispose();
  });
  it('drops a delayed imported-record question after the screen locks', async () => {
    const s = setup();
    s.request();
    expect((await s.admission.openFromNativeAction()).kind).toBe('open');
    const delayed = deferred<{ kind: 'accept'; digest: string; questionId: string; notice: string; question: string }>();
    s.link.question.mockReturnValueOnce(delayed.promise);
    const question = s.admission.questionFromNativeAction('imported');
    const revoking = s.admission.revokeGlobal('screen-lock');
    delayed.resolve({ kind: 'accept', digest: 'a'.repeat(64), questionId: 'q', notice: 'Private notice', question: 'Accept?' });
    await expect(question).rejects.toThrow('closed during review');
    await revoking;
  });
  it('drops a delayed imported-record listing after the screen locks', async () => {
    const s = setup();
    s.request();
    expect((await s.admission.openFromNativeAction()).kind).toBe('open');
    const listing = s.admission.listUnverifiedFromNativeAction();
    const requestId = s.link.session.send.mock.calls.at(-1)?.[0].requestId as string;
    const revoking = s.admission.revokeGlobal('screen-lock');
    s.sendRuntime({ type: 'sessions', requestId, listing: {
      currentSessionId: 'current', unreadableSessionIds: [], sessions: [
        { id: 'imported', cwd: '/fixture', updatedAt: '2026-11-07', messageCount: 0, preview: '', authorship: 'unverified' },
      ],
    } });
    await expect(listing).rejects.toThrow();
    await revoking;
  });
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
    expect(s.link.lock).toHaveBeenCalledWith('fault');
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

  it('closes only its own grant after the owner link closes', async () => {
    const s = setup();
    s.request();
    expect((await s.admission.openFromNativeAction()).kind).toBe('open');
    s.closeLink();
    await s.admission.dispose();
    expect(s.link.lock).not.toHaveBeenCalled();
    expect(s.onUnconfirmed).not.toHaveBeenCalled();
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

  it('releases the local owner grant when the relay closes', async () => {
    const s = setup();
    s.request();
    expect((await s.admission.openFromNativeAction()).kind).toBe('open');
    relay.open.mock.calls[0]?.[0].onClosed();
    await s.admission.dispose();
    expect(s.link.lock).not.toHaveBeenCalled();
    expect(s.link.close).toHaveBeenCalledOnce();
    expect(s.release).toHaveBeenCalledOnce();
    expect(s.onDisposed).toHaveBeenCalledOnce();
    expect((await s.admission.openFromNativeAction()).kind).toBe('not-ready');
  });

  it('reports an unconfirmed global lock after a screen lock', async () => {
    const s = setup();
    s.request();
    expect((await s.admission.openFromNativeAction()).kind).toBe('open');
    s.link.lock.mockRejectedValueOnce(new Error('lock failed'));
    await expect(s.admission.revokeGlobal('screen-lock')).rejects.toThrow('The runtime lock could not be confirmed.');
    expect(s.link.lock).toHaveBeenCalledWith('screen-lock');
    expect(s.onUnconfirmed).toHaveBeenCalledOnce();
    expect(s.onDisposed).not.toHaveBeenCalled();
    expect(s.link.close).toHaveBeenCalledOnce();
    expect(s.release).toHaveBeenCalledOnce();
  });

  it('escalates an in-flight local detach to a global screen lock', async () => {
    const s = setup();
    s.request();
    expect((await s.admission.openFromNativeAction()).kind).toBe('open');
    const detach = deferred<Readonly<Record<string, unknown>>>();
    const original = s.link.control.getMockImplementation()!;
    s.link.control.mockImplementation(async (request) =>
      request.command === 'owner-detach' ? detach.promise : original(request));
    const disposing = s.admission.dispose();
    await vi.waitFor(() => expect(s.link.control).toHaveBeenCalledWith({ command: 'owner-detach', fields: {} }));
    const revoking = s.admission.revokeGlobal('screen-lock');
    expect(s.link.revokeToCleanup).toHaveBeenCalledOnce();
    expect(s.release).toHaveBeenCalledOnce();
    expect(s.link.lock).toHaveBeenCalledExactlyOnceWith('screen-lock');
    detach.resolve({ status: 'detached' });
    await Promise.all([disposing, revoking]);
    expect(s.link.lock).toHaveBeenCalledExactlyOnceWith('screen-lock');
    expect(s.onUnconfirmed).not.toHaveBeenCalled();
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
    expect(s.link.lock).not.toHaveBeenCalled();
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
    expect(s.link.lock).not.toHaveBeenCalled();
    expect(s.link.close).toHaveBeenCalledOnce();
    expect(s.release).toHaveBeenCalledOnce();
    expect(s.onUnconfirmed).not.toHaveBeenCalled();
  });

});
