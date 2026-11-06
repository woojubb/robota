import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { createDesktopOwnerCoordinator } from '../desktop-owner-seam.js';

import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup() {
  const closed = deferred<void>();
  let receive: ((message: TServerMessage) => void) | undefined;
  let custody: ((value: { certified: boolean; unlocked: boolean }) => void) | undefined;
  const session = {
    send: vi.fn((_message: TClientMessage) => {}),
    onMessage: vi.fn((listener: (message: TServerMessage) => void) => { receive = listener; return () => { receive = undefined; }; }),
  };
  const link = {
    standing: 'owner' as const,
    binding: { runtimeId: 'runtime-a', generation: 'generation-a' },
    custody: { certified: true, unlocked: false },
    session,
    closed: closed.promise,
    close: vi.fn(),
    onCustody: vi.fn((listener: (value: { certified: boolean; unlocked: boolean }) => void) => { custody = listener; return () => { custody = undefined; }; }),
    control: vi.fn(async (request: { command: string }): Promise<Readonly<Record<string, unknown>>> => request.command === 'status'
      ? { status: 'running', daemon: true, cwd: '/synthetic/workspace' }
      : { status: 'attached', driverId: 'driver-a' }),
    unlock: vi.fn(async () => 'verified' as const),
    lock: vi.fn(async () => {}),
  };
  const release = vi.fn();
  const openOwner = vi.fn(async () => ({ link, release }));
  const requestSecret = vi.fn(async () => ({ type: 'passphrase' as const, value: 'synthetic' }));
  const observed: TServerMessage[] = [];
  const relayDispose = vi.fn();
  const openRelay = vi.fn((channel: { send(message: TClientMessage): void; onMessage(listener: (message: TServerMessage) => void): () => void }) => {
    channel.onMessage((message) => observed.push(message));
    return { dispose: relayDispose };
  });
  const coordinator = createDesktopOwnerCoordinator({
    expected: { runtimeId: 'runtime-a', generation: 'generation-a', workspace: '/synthetic/workspace', restricted: false },
    requestSecret, openOwner, openRelay,
  });
  const controller = new AbortController();
  return { coordinator, controller, link, session, release, openOwner, requestSecret, openRelay, relayDispose,
    observed, receive: (message: TServerMessage) => receive?.(message),
    custody: (value: { certified: boolean; unlocked: boolean }) => custody?.(value),
    closeLink: () => closed.resolve() };
}

describe('main-only desktop owner session boundary', () => {
  it('checks the authenticated link status before unlock and exposes only its session channel', async () => {
    const s = setup();
    const result = await s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
    expect(result.kind).toBe('open');
    expect(s.link.control.mock.calls[0][0]).toEqual({ command: 'status', fields: {} });
    expect(s.link.control.mock.invocationCallOrder[0]).toBeLessThan(s.link.unlock.mock.invocationCallOrder[0]);
    expect(s.openRelay).toHaveBeenCalledOnce();
    expect(s.openRelay.mock.calls[0][0]).not.toBe(s.link);
    expect(Object.keys(s.openRelay.mock.calls[0][0]).sort()).toEqual(['onMessage', 'send']);
    expect(result).not.toHaveProperty('link');
    expect(result).not.toHaveProperty('secret');
    if (result.kind === 'open') await result.close();
    expect(s.link.lock).toHaveBeenCalledWith('explicit');
    expect(s.link.close).toHaveBeenCalledOnce();
    expect(s.release).toHaveBeenCalledOnce();
  });

  it.each(['binding', 'workspace', 'mode', 'daemon'] as const)('refuses a wrong %s before granting', async (kind) => {
    const s = setup();
    if (kind === 'binding') s.link.binding.generation = 'different';
    if (kind === 'workspace') s.link.control.mockResolvedValueOnce({ status: 'running', daemon: true, cwd: '/other' });
    if (kind === 'mode') s.link.control.mockResolvedValueOnce({ status: 'running', daemon: true, cwd: '/synthetic/workspace', restricted: true });
    if (kind === 'daemon') s.link.control.mockResolvedValueOnce({ status: 'running', cwd: '/synthetic/workspace' });
    const result = await s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
    expect(result.kind).toBe('refused');
    expect(s.link.unlock).not.toHaveBeenCalled();
    expect(s.openRelay).not.toHaveBeenCalled();
    expect(s.link.close).toHaveBeenCalledOnce();
    expect(s.release).toHaveBeenCalledOnce();
  });

  it('closes a late owner result after cancellation without granting it', async () => {
    const s = setup();
    const late = deferred<{ link: typeof s.link; release: typeof s.release }>();
    s.openOwner.mockReturnValueOnce(late.promise);
    const result = s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
    await vi.waitFor(() => expect(s.openOwner).toHaveBeenCalledOnce());
    s.controller.abort();
    expect((await result).kind).toBe('cancelled');
    late.resolve({ link: s.link, release: s.release });
    await vi.waitFor(() => expect(s.link.close).toHaveBeenCalledOnce());
    expect(s.release).toHaveBeenCalledOnce();
    expect(s.link.unlock).not.toHaveBeenCalled();
    expect(s.openRelay).not.toHaveBeenCalled();
  });

  it('reports an uncertain lock and never opens a relay if cancelled during a grant', async () => {
    const s = setup();
    const pending = deferred<'verified'>();
    s.link.unlock.mockReturnValueOnce(pending.promise);
    const result = s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
    await vi.waitFor(() => expect(s.link.unlock).toHaveBeenCalledOnce());
    s.controller.abort();
    expect((await result).kind).toBe('lock-unconfirmed');
    expect(s.link.lock).toHaveBeenCalledWith('explicit');
    expect(s.link.close).toHaveBeenCalledOnce();
    expect(s.release).toHaveBeenCalledOnce();
    pending.resolve('verified');
    await Promise.resolve();
    expect(s.openRelay).not.toHaveBeenCalled();
  });

  it('preserves a session frame arriving before attachment and disposes on lock', async () => {
    const s = setup();
    const status = deferred<{ status: string; daemon: boolean; cwd: string }>();
    s.link.control.mockReturnValueOnce(status.promise);
    const resultPromise = s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
    await vi.waitFor(() => expect(s.session.onMessage).toHaveBeenCalledOnce());
    const frame: TServerMessage = { type: 'error', message: 'synthetic' };
    s.receive(frame);
    status.resolve({ status: 'running', daemon: true, cwd: '/synthetic/workspace' });
    expect((await resultPromise).kind).toBe('open');
    expect(s.observed).toEqual([frame]);
    s.custody({ certified: true, unlocked: false });
    await vi.waitFor(() => expect(s.relayDispose).toHaveBeenCalledOnce());
    expect(s.link.close).toHaveBeenCalledOnce();
    expect(s.release).toHaveBeenCalledOnce();
  });
  it('does not prompt after cancellation already happened', async () => {
    const s = setup();
    s.controller.abort();
    expect((await s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true })).kind).toBe('cancelled');
    expect(s.requestSecret).not.toHaveBeenCalled();
  });

  it('disposes an owner returned at the same moment cancellation occurs', async () => {
    const s = setup();
    s.openOwner.mockImplementationOnce(() => {
      s.controller.abort();
      return Promise.resolve({ link: s.link, release: s.release });
    });
    expect((await s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true })).kind).toBe('cancelled');
    await vi.waitFor(() => expect(s.link.close).toHaveBeenCalledOnce());
    expect(s.release).toHaveBeenCalledOnce();
  });

  it('keeps the coordinator occupied until a cancelled opening releases its late owner', async () => {
    const s = setup();
    const late = deferred<{ link: typeof s.link; release: typeof s.release }>();
    s.openOwner.mockReturnValueOnce(late.promise);
    const first = s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
    await vi.waitFor(() => expect(s.openOwner).toHaveBeenCalledOnce());
    s.controller.abort();
    expect((await first).kind).toBe('cancelled');
    const next = new AbortController();
    expect((await s.coordinator.open({ signal: next.signal, isCurrent: () => true })).kind).toBe('busy');
    late.resolve({ link: s.link, release: s.release });
    await vi.waitFor(() => expect(s.release).toHaveBeenCalledOnce());
  });

  it('treats a rejected grant as unconfirmed even if a lock request succeeds', async () => {
    const s = setup();
    s.link.unlock.mockRejectedValueOnce(new Error('disconnected'));
    expect((await s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true })).kind).toBe('lock-unconfirmed');
    expect(s.openRelay).not.toHaveBeenCalled();
    expect(s.link.close).toHaveBeenCalledOnce();
  });

  it('refuses overflow during initial subscription without requesting runtime status', async () => {
    const s = setup();
    s.session.onMessage.mockImplementationOnce((listener) => {
      for (let count = 0; count < 1025; count++) listener({ type: 'error', message: 'synthetic' });
      return () => {};
    });
    const result = await s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
    expect(result.kind).toBe('cancelled');
    expect(s.link.control).not.toHaveBeenCalled();
    expect(s.link.unlock).not.toHaveBeenCalled();
    expect(s.link.close).toHaveBeenCalledOnce();
  });

  it('cleans up once when relay disposal synchronously reports a locked state', async () => {
    const s = setup();
    const result = await s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
    expect(result.kind).toBe('open');
    let reentered = false;
    s.relayDispose.mockImplementation(() => {
      if (!reentered) { reentered = true; s.custody({ certified: true, unlocked: false }); }
    });
    if (result.kind === 'open') await result.close();
    expect(s.relayDispose).toHaveBeenCalledOnce();
    expect(s.link.lock).toHaveBeenCalledOnce();
    expect(s.link.close).toHaveBeenCalledOnce();
    expect(s.release).toHaveBeenCalledOnce();
  });

  it('does not start another attempt after a grant could not be confirmed locked', async () => {
    const s = setup();
    const pending = deferred<'verified'>();
    s.link.unlock.mockReturnValueOnce(pending.promise);
    const first = s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
    await vi.waitFor(() => expect(s.link.unlock).toHaveBeenCalledOnce());
    s.controller.abort();
    expect((await first).kind).toBe('lock-unconfirmed');
    pending.resolve('verified');
    const next = new AbortController();
    expect((await s.coordinator.open({ signal: next.signal, isCurrent: () => true })).kind).toBe('lock-unconfirmed');
    expect(s.requestSecret).toHaveBeenCalledOnce();
  });

  it('releases the handover and remains unavailable if closing a late owner throws', async () => {
    const s = setup();
    const late = deferred<{ link: typeof s.link; release: typeof s.release }>();
    s.openOwner.mockReturnValueOnce(late.promise);
    const first = s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
    await vi.waitFor(() => expect(s.openOwner).toHaveBeenCalledOnce());
    s.controller.abort();
    expect((await first).kind).toBe('cancelled');
    s.link.close.mockImplementationOnce(() => { throw new Error('close failed'); });
    late.resolve({ link: s.link, release: s.release });
    await vi.waitFor(() => expect(s.release).toHaveBeenCalledOnce());
    const next = new AbortController();
    expect((await s.coordinator.open({ signal: next.signal, isCurrent: () => true })).kind).toBe('busy');
  });

  it('allows retry when opening the owner throws synchronously without returning a resource', async () => {
    const s = setup();
    s.openOwner.mockImplementationOnce(() => { throw new Error('unavailable'); });
    expect((await s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true })).kind).toBe('refused');
    const next = new AbortController();
    const result = await s.coordinator.open({ signal: next.signal, isCurrent: () => true });
    expect(result.kind).toBe('open');
    if (result.kind === 'open') await result.close();
  });

  it('keeps early frames ordered when a listener synchronously receives another frame', async () => {
    const s = setup();
    const status = deferred<{ status: string; daemon: boolean; cwd: string }>();
    s.link.control.mockReturnValueOnce(status.promise);
    s.openRelay.mockImplementationOnce((channel) => {
      channel.onMessage((message) => {
        s.observed.push(message);
        if (message.type === 'error' && message.message === 'a') s.receive({ type: 'error', message: 'c' });
      });
      return { dispose: s.relayDispose };
    });
    const pending = s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
    await vi.waitFor(() => expect(s.session.onMessage).toHaveBeenCalledOnce());
    s.receive({ type: 'error', message: 'a' });
    s.receive({ type: 'error', message: 'b' });
    status.resolve({ status: 'running', daemon: true, cwd: '/synthetic/workspace' });
    const result = await pending;
    expect(s.observed).toEqual(['a', 'b', 'c'].map((message) => ({ type: 'error', message })));
    if (result.kind === 'open') await result.close();
  });

  it('refuses a grant when certification is withdrawn during status', async () => {
    const s = setup();
    const status = deferred<{ status: string; daemon: boolean; cwd: string }>();
    s.link.control.mockReturnValueOnce(status.promise);
    const result = s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
    await vi.waitFor(() => expect(s.link.control).toHaveBeenCalledOnce());
    s.custody({ certified: false, unlocked: false });
    status.resolve({ status: 'running', daemon: true, cwd: '/synthetic/workspace' });
    expect((await result).kind).toBe('cancelled');
    expect(s.link.unlock).not.toHaveBeenCalled();
    expect(s.openRelay).not.toHaveBeenCalled();
  });

  it('observes a rejected status request when cancellation occurs during invocation', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-owner-rejection-'));
    try {
      const source = pathToFileURL(join(process.cwd(), 'electron/desktop-owner-seam.ts')).href;
      const tsx = pathToFileURL(createRequire(join(process.cwd(), 'package.json')).resolve('tsx')).href;
      const program = `
        import ownerModule from ${JSON.stringify(source)};
        const { createDesktopOwnerCoordinator } = ownerModule;
        process.on('unhandledRejection', () => { process.exitCode = 3; });
        const controller = new AbortController();
        const link = {
          standing: 'owner', binding: { runtimeId: 'r', generation: 'g' }, custody: { certified: true, unlocked: false },
          closed: new Promise(() => {}), session: { send() {}, onMessage() { return () => {}; } },
          onCustody() { return () => {}; }, close() {}, unlock: async () => 'verified', lock: async () => {},
          control() { controller.abort(); return Promise.reject(new Error('synthetic')); },
        };
        const owner = createDesktopOwnerCoordinator({
          expected: { runtimeId: 'r', generation: 'g', workspace: '/fixture', restricted: false },
          requestSecret: async () => ({ type: 'passphrase', value: 'synthetic' }),
          openOwner: async () => ({ link, release() {} }), openRelay: () => ({ dispose() {} }),
        });
        if ((await owner.open({ signal: controller.signal, isCurrent: () => true })).kind !== 'cancelled') process.exitCode = 4;
        await new Promise((resolve) => setImmediate(resolve));
      `;
      const env = { PATH: process.env.PATH ?? '', HOME: root, USERPROFILE: root, PRODUCT_USER_STATE_DIR: root,
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
      const child = spawnSync(process.execPath, ['--import', tsx, '--conditions=source', '--input-type=module', '-e', program],
        { cwd: root, env, encoding: 'utf8', timeout: 10_000 });
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('times out an unresponsive owner connection and keeps its slot until it is released', async () => {
    vi.useFakeTimers();
    try {
      const s = setup();
      const started = deferred<void>();
      const late = deferred<{ link: typeof s.link; release: typeof s.release }>();
      s.openOwner.mockImplementationOnce(() => { started.resolve(); return late.promise; });
      const pending = s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
      await started.promise;
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await pending).kind).toBe('timed-out');
      const next = new AbortController();
      expect((await s.coordinator.open({ signal: next.signal, isCurrent: () => true })).kind).toBe('busy');
      late.resolve({ link: s.link, release: s.release });
      await Promise.resolve();
      await Promise.resolve();
      expect(s.link.close).toHaveBeenCalledOnce();
      expect(s.release).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('reports an unconfirmed lock on grant timeout and does not retry', async () => {
    vi.useFakeTimers();
    try {
      const s = setup();
      const started = deferred<void>();
      const pendingGrant = deferred<'verified'>();
      s.link.unlock.mockImplementationOnce(() => { started.resolve(); return pendingGrant.promise; });
      const pending = s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
      await started.promise;
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await pending).kind).toBe('lock-unconfirmed');
      expect(s.link.lock).toHaveBeenCalledOnce();
      expect(s.link.close).toHaveBeenCalledOnce();
      expect(s.openRelay).not.toHaveBeenCalled();
      pendingGrant.resolve('verified');
    } finally { vi.useRealTimers(); }
  });

  it('closes the relay when the owner link ends', async () => {
    const s = setup();
    const result = await s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
    expect(result.kind).toBe('open');
    s.closeLink();
    await vi.waitFor(() => expect(s.relayDispose).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(s.release).toHaveBeenCalledOnce());
  });

  it('refuses a link without owner standing before granting', async () => {
    const s = setup();
    Object.defineProperty(s.link, 'standing', { value: 'spawner' });
    expect((await s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true })).kind).toBe('refused');
    expect(s.link.unlock).not.toHaveBeenCalled();
    expect(s.openRelay).not.toHaveBeenCalled();
    expect(s.release).toHaveBeenCalledOnce();
  });

  it('does not grant if the link closes while status is pending', async () => {
    const s = setup();
    const status = deferred<{ status: string; daemon: boolean; cwd: string }>();
    s.link.control.mockReturnValueOnce(status.promise);
    const pending = s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
    await vi.waitFor(() => expect(s.link.control).toHaveBeenCalledOnce());
    s.closeLink();
    status.resolve({ status: 'running', daemon: true, cwd: '/synthetic/workspace' });
    expect((await pending).kind).toBe('cancelled');
    expect(s.link.unlock).not.toHaveBeenCalled();
    expect(s.openRelay).not.toHaveBeenCalled();
  });

  it('does not grant if the selected runtime changes while status is pending', async () => {
    const s = setup();
    const status = deferred<{ status: string; daemon: boolean; cwd: string }>();
    s.link.control.mockReturnValueOnce(status.promise);
    let current = true;
    const pending = s.coordinator.open({ signal: s.controller.signal, isCurrent: () => current });
    await vi.waitFor(() => expect(s.link.control).toHaveBeenCalledOnce());
    current = false;
    status.resolve({ status: 'running', daemon: true, cwd: '/synthetic/workspace' });
    expect((await pending).kind).toBe('cancelled');
    expect(s.link.unlock).not.toHaveBeenCalled();
    expect(s.openRelay).not.toHaveBeenCalled();
  });

  it('remains unavailable when a lock request cannot be confirmed in time', async () => {
    const s = setup();
    const result = await s.coordinator.open({ signal: s.controller.signal, isCurrent: () => true });
    expect(result.kind).toBe('open');
    s.link.lock.mockReturnValueOnce(new Promise(() => {}));
    vi.useFakeTimers();
    try {
      if (result.kind !== 'open') throw new Error('Expected an open session.');
      const closing = result.close();
      const rejected = expect(closing).rejects.toThrow('The runtime lock could not be confirmed.');
      await vi.advanceTimersByTimeAsync(5_000);
      await rejected;
      expect(s.link.close).toHaveBeenCalledOnce();
      expect(s.release).toHaveBeenCalledOnce();
      const next = new AbortController();
      expect((await s.coordinator.open({ signal: next.signal, isCurrent: () => true })).kind).toBe('lock-unconfirmed');
    } finally { vi.useRealTimers(); }
  });

});
