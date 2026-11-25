import { once } from 'node:events';
import { PassThrough } from 'node:stream';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface/session/testing';
import { describe, expect, it, vi } from 'vitest';

import {
  createHandshakeApprover,
  createSupervisedAttachCarrier,
  MAX_ATTACHED_SURFACES,
} from '../supervised-attach.js';

import type { ISessionBinder, ISessionDirectory } from '@robota-sdk/agent-interface/session';
import type { IProtocolSession } from '@robota-sdk/agent-transport';

function binderOf(
  session: IProtocolSession,
  directory: ISessionDirectory,
): ISessionBinder<IProtocolSession> & {
  bind: ReturnType<typeof vi.fn>;
  released: ReturnType<typeof vi.fn>;
} {
  const released = vi.fn();
  return {
    released,
    bind: vi.fn(() => ({ session, directory, release: released })),
  };
}

describe('attach handshake approval', () => {
  it('answers yes once, for the requested role on this connection, and never for anything else', async () => {
    const approver = createHandshakeApprover('observe');
    expect(
      await approver.approve({ capability: 'drive', scope: 'connection', locality: 'same-host' }),
    ).toBe(false);
    expect(
      await approver.approve({ capability: 'delegate', scope: 'request', locality: 'same-host' }),
    ).toBe(false);
    expect(
      await approver.approve({ capability: 'observe', scope: 'request', locality: 'same-host' }),
    ).toBe(false);
    expect(
      await approver.approve({ capability: 'observe', scope: 'connection', locality: 'same-host' }),
    ).toBe(true);
    expect(
      await approver.approve({ capability: 'observe', scope: 'connection', locality: 'same-host' }),
    ).toBe(false);
  });
});

describe('attach bindings', () => {
  it('binds each admitted connection in its own role and releases it when that connection closes', async () => {
    const directory: ISessionDirectory = {
      listSessions: vi.fn(),
      switchSession: vi.fn(async () => undefined),
      newSession: vi.fn(async () => undefined),
      renameSession: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
    };
    const binder = binderOf(createTestInteractiveSession(), directory);
    const carrier = createSupervisedAttachCarrier({ binder });
    const driver = new PassThrough();
    const observer = new PassThrough();
    const accept = vi.fn();
    await carrier.admit(driver as never, { mode: 'drive', protocol: 1 }, '', {
      refuse: vi.fn(),
      accept,
    });
    await carrier.admit(observer as never, { mode: 'observe', protocol: 1 }, '', {
      refuse: vi.fn(),
      accept,
    });

    expect(binder.bind.mock.calls).toEqual([['drive'], ['observe']]);
    expect(binder.released).not.toHaveBeenCalled();
    driver.destroy();
    await once(driver, 'close');
    expect(binder.released).toHaveBeenCalledTimes(1);
    observer.destroy();
    await once(observer, 'close');
    expect(binder.released).toHaveBeenCalledTimes(2);
  });

  it('binds nothing for a handshake it refuses', async () => {
    const binder = binderOf(createTestInteractiveSession(), {
      listSessions: vi.fn(),
      switchSession: vi.fn(async () => undefined),
      newSession: vi.fn(async () => undefined),
      renameSession: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
    });
    const carrier = createSupervisedAttachCarrier({ binder });
    const refuse = vi.fn();
    await carrier.admit(new PassThrough() as never, { mode: 'steer', protocol: 1 }, '', {
      refuse,
      accept: vi.fn(),
    });
    expect(refuse).toHaveBeenCalledWith('unsupported-attach');
    expect(binder.bind).not.toHaveBeenCalled();
  });
});

describe('attach slot reservation', () => {
  it('never holds a slot for a connection that closed before its handshake was admitted', async () => {
    const carrier = createSupervisedAttachCarrier({ session: createTestInteractiveSession() });
    const request = { mode: 'observe', protocol: 1 };
    for (let index = 0; index < MAX_ATTACHED_SURFACES; index++) {
      const gone = new PassThrough();
      gone.destroy();
      await once(gone, 'close');
      await carrier.admit(gone as never, request, '', { refuse: vi.fn(), accept: vi.fn() });
    }
    const accept = vi.fn();
    const refuse = vi.fn();
    const live = Array.from({ length: MAX_ATTACHED_SURFACES }, () => new PassThrough());
    for (const socket of live)
      await carrier.admit(socket as never, request, '', { refuse, accept });
    expect(refuse).not.toHaveBeenCalled();
    expect(accept).toHaveBeenCalledTimes(MAX_ATTACHED_SURFACES);
    for (const socket of live) socket.destroy();
  });
});
