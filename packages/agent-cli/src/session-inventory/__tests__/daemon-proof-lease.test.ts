import { describe, expect, it, vi } from 'vitest';

import type { IOwnerHandover } from '@robota-sdk/agent-keyring';
import type { IOwnerRuntimeLinkClient } from '@robota-sdk/agent-transport-link';

const opener = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../owner-link-client.js', () => ({ openRegisteredOwnerLink: opener.open }));
import { proveWorkspaceDaemon } from '../prove-workspace-daemon.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const row = { id: 'runtime', generation: 'generation', liveness: 'alive', control: 'available', activity: 'idle' } as const;

describe('CLI daemon proof owner lifetime', () => {
  it('holds the handover until the late link closes after timeout', async () => {
    const late = deferred<IOwnerRuntimeLinkClient>();
    const timedOut = deferred<void>();
    opener.open.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
      signal.addEventListener('abort', () => timedOut.resolve(), { once: true });
      return late.promise;
    });
    const dispose = vi.fn();
    const handover = { dispose } as unknown as IOwnerHandover;
    const attempt = proveWorkspaceDaemon({ root: '/fixture', workspace: '/fixture', candidates: [row], handover, timeoutMs: 20 });
    const disposed = attempt.finally(dispose);
    void disposed.catch(() => {});
    await vi.waitFor(() => expect(opener.open).toHaveBeenCalled());
    await timedOut.promise;
    expect(dispose).not.toHaveBeenCalled();
    const close = vi.fn();
    late.resolve({ close, closed: Promise.resolve() } as unknown as IOwnerRuntimeLinkClient);
    await expect(disposed).rejects.toThrow(/timed out/i);
    expect(close).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('holds the handover until the late link reports actual closure', async () => {
    const late = deferred<IOwnerRuntimeLinkClient>();
    const closed = deferred<void>();
    const timedOut = deferred<void>();
    opener.open.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
      signal.addEventListener('abort', () => timedOut.resolve(), { once: true });
      return late.promise;
    });
    const dispose = vi.fn();
    const handover = { dispose } as unknown as IOwnerHandover;
    const attempt = proveWorkspaceDaemon({ root: '/fixture', workspace: '/fixture', candidates: [row], handover, timeoutMs: 20 });
    const disposed = attempt.finally(dispose);
    void disposed.catch(() => {});
    await timedOut.promise;
    const close = vi.fn();
    late.resolve({ close, closed: closed.promise } as unknown as IOwnerRuntimeLinkClient);
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(dispose).not.toHaveBeenCalled();
    closed.resolve();
    await expect(disposed).rejects.toThrow(/timed out/i);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('reports late cleanup failure and faults the same handover', async () => {
    const late = deferred<IOwnerRuntimeLinkClient>();
    const timedOut = deferred<void>();
    opener.open.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
      signal.addEventListener('abort', () => timedOut.resolve(), { once: true });
      return late.promise;
    });
    const handover = {} as IOwnerHandover;
    const attempt = proveWorkspaceDaemon({ root: '/fixture', workspace: '/fixture', candidates: [row], handover, timeoutMs: 20 });
    await timedOut.promise;
    late.resolve({ close: () => { throw new Error('close failed'); }, closed: Promise.resolve() } as unknown as IOwnerRuntimeLinkClient);
    await expect(attempt).rejects.toThrow(/cleanup/i);
    await expect(proveWorkspaceDaemon({ root: '/fixture', workspace: '/fixture', candidates: [row], handover })).rejects.toThrow(/cleanup/i);
  });
});
