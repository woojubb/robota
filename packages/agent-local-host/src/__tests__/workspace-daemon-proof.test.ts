import { describe, expect, it, vi } from 'vitest';

import { createWorkspaceDaemonProver } from '../workspace-daemon-proof.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const row = { id: 'runtime', generation: 'generation', liveness: 'alive', control: 'available', activity: 'idle' } as const;
const status = { status: 'running', daemon: true, cwd: '/workspace' } as const;
const link = () => ({ control: vi.fn(async (): Promise<Readonly<Record<string, unknown>>> => status), close: vi.fn(), closed: Promise.resolve() });

function proveWorkspaceDaemon(options: Parameters<ReturnType<typeof createWorkspaceDaemonProver>['start']>[0] & Parameters<typeof createWorkspaceDaemonProver>[0]) {
  const { open, ...input } = options;
  return createWorkspaceDaemonProver({ open }).start(input).result;
}

describe('authenticated workspace daemon proof', () => {
  it('authenticates an unprobed registration before reporting control as available', async () => {
    const first = link();
    const open = vi.fn(async () => first);
    const prover = createWorkspaceDaemonProver({ open });
    const attempt = prover.start({ workspace: '/workspace', candidates: [{ ...row, control: 'unprobed' }] });
    await expect(attempt.result).resolves.toMatchObject({ id: row.id, control: 'available', daemon: true });
    await attempt.settled;
    expect(open).toHaveBeenCalledOnce();
    expect(first.close).toHaveBeenCalledOnce();
  });

  it('rejects an invalid control state without opening a link', async () => {
    const open = vi.fn(async () => link());
    const prover = createWorkspaceDaemonProver({ open });
    const invalid = { ...row, control: 'forged' } as unknown as typeof row;
    const attempt = prover.start({ workspace: '/workspace', candidates: [invalid] });
    await expect(attempt.result).rejects.toThrow(/unproven/i);
    await attempt.settled;
    expect(open).not.toHaveBeenCalled();
  });

  it('continues past a match and fails closed on an unproven later candidate', async () => {
    const first = link();
    const open = vi.fn(async () => first);
    await expect(proveWorkspaceDaemon({ workspace: '/workspace', open,
      candidates: [row, { ...row, id: 'other', liveness: 'unknown' }] })).rejects.toThrow(/unproven/i);
    expect(open).toHaveBeenCalledOnce();
    expect(first.close).toHaveBeenCalledOnce();
  });

  it('uses authenticated status rather than public daemon or workspace fields', async () => {
    const first = link();
    first.control.mockResolvedValueOnce({ ...status, cwd: '/other' });
    const second = link();
    const open = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const forged = { ...row, cwd: '/workspace', daemon: true };
    const result = await proveWorkspaceDaemon({ workspace: '/workspace', open,
      candidates: [forged, { ...row, id: 'other' }] });
    expect(result).toMatchObject({ id: 'other', generation: 'generation', cwd: '/workspace', daemon: true });
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
  });

  it.each([['first', 'second'], ['second', 'first']] as const)(
    'refuses two independently proved daemons in %s then %s order', async (firstId, secondId) => {
      const first = link();
      const second = link();
      const open = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
      await expect(proveWorkspaceDaemon({ workspace: '/workspace', open,
        candidates: [{ ...row, id: firstId }, { ...row, id: secondId }] })).rejects.toThrow(/ambiguous/i);
      expect(first.close).toHaveBeenCalledOnce();
      expect(second.close).toHaveBeenCalledOnce();
    },
  );

  it('refuses incomplete status even after a matching candidate', async () => {
    const first = link();
    const second = link();
    second.control.mockResolvedValueOnce({ status: 'running', daemon: true } as typeof status);
    const open = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await expect(proveWorkspaceDaemon({ workspace: '/workspace', open, candidates: [row, { ...row, id: 'other' }] })).rejects.toThrow(/unproven/i);
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
  });

  it('rejects an invalid restricted flag and closes the authenticated link', async () => {
    const first = link();
    first.control.mockResolvedValueOnce({ ...status, restricted: false });
    await expect(proveWorkspaceDaemon({ workspace: '/workspace', open: async () => first,
      candidates: [row] })).rejects.toThrow(/unproven/i);
    expect(first.close).toHaveBeenCalledOnce();
  });

  it('rejects a candidate if its authenticated link could not be closed', async () => {
    const first = link();
    first.close.mockImplementation(() => { throw new Error('close failed'); });
    await expect(proveWorkspaceDaemon({ workspace: '/workspace', open: async () => first,
      candidates: [row] })).rejects.toThrow(/cleanup/i);
  });

  it('cancels an opener that ignores abort and closes its late link', async () => {
    const aborter = new AbortController();
    const pending = deferred<ReturnType<typeof link>>();
    const open = vi.fn(() => pending.promise);
    const proof = proveWorkspaceDaemon({ workspace: '/workspace', open, candidates: [row], signal: aborter.signal });
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    aborter.abort();
    await expect(proof).rejects.toThrow(/cancelled/i);
    const late = link();
    pending.resolve(late);
    await vi.waitFor(() => expect(late.close).toHaveBeenCalledOnce());
    expect(late.control).not.toHaveBeenCalled();
  });

  it('closes a just-opened link when cancellation races the opener resolution', async () => {
    const aborter = new AbortController();
    const pending = deferred<ReturnType<typeof link>>();
    const open = vi.fn(() => pending.promise);
    const proof = proveWorkspaceDaemon({ workspace: '/workspace', open, candidates: [row], signal: aborter.signal });
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    const opened = link();
    pending.resolve(opened);
    queueMicrotask(() => aborter.abort());
    await expect(proof).rejects.toThrow(/cancelled/i);
    expect(opened.close).toHaveBeenCalledOnce();
    expect(opened.control).not.toHaveBeenCalled();
  });

  it('does not return a candidate when cancellation occurs during link cleanup', async () => {
    const aborter = new AbortController();
    const first = link();
    first.close.mockImplementation(() => aborter.abort());
    await expect(proveWorkspaceDaemon({ workspace: '/workspace', open: async () => first,
      candidates: [row], signal: aborter.signal })).rejects.toThrow(/cancelled/i);
    expect(first.close).toHaveBeenCalledOnce();
  });

  it('times out a status request that ignores link closure', async () => {
    const pending = deferred<typeof status>();
    const first = link();
    first.control.mockReturnValueOnce(pending.promise);
    await expect(proveWorkspaceDaemon({ workspace: '/workspace', open: async () => first,
      candidates: [row], timeoutMs: 20 })).rejects.toThrow(/timed out/i);
    expect(first.close).toHaveBeenCalledOnce();
    pending.resolve(status);
  });
  it('keeps the lease occupied until a cancelled late link is closed', async () => {
    const aborter = new AbortController();
    const pending = deferred<ReturnType<typeof link>>();
    const open = vi.fn(() => pending.promise);
    const prover = createWorkspaceDaemonProver({ open });
    const attempt = prover.start({ workspace: '/workspace', candidates: [row], signal: aborter.signal });
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    aborter.abort();
    await expect(attempt.result).rejects.toThrow(/cancelled/i);
    expect(() => prover.start({ workspace: '/workspace', candidates: [row] })).toThrow(/busy/i);
    const late = link();
    pending.resolve(late);
    await expect(attempt.settled).resolves.toBeUndefined();
    expect(late.close).toHaveBeenCalledOnce();
    const next = prover.start({ workspace: '/workspace', candidates: [] });
    await expect(next.result).resolves.toBeUndefined();
    await next.settled;
  });

  it('faults the lease when a late link cannot close', async () => {
    const aborter = new AbortController();
    const pending = deferred<ReturnType<typeof link>>();
    const open = vi.fn(() => pending.promise);
    const prover = createWorkspaceDaemonProver({ open });
    const attempt = prover.start({ workspace: '/workspace', candidates: [row], signal: aborter.signal });
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    aborter.abort();
    await expect(attempt.result).rejects.toThrow(/cancelled/i);
    const late = link();
    late.close.mockImplementation(() => { throw new Error('close failed'); });
    pending.resolve(late);
    await expect(attempt.settled).rejects.toThrow(/cleanup/i);
    expect(late.close).toHaveBeenCalledOnce();
    expect(() => prover.start({ workspace: '/workspace', candidates: [row] })).toThrow(/cleanup/i);
  });

  it('reports a current link close failure instead of cancellation', async () => {
    const aborter = new AbortController();
    const pending = deferred<typeof status>();
    const first = link();
    first.control.mockReturnValueOnce(pending.promise);
    first.close.mockImplementation(() => { throw new Error('close failed'); });
    const prover = createWorkspaceDaemonProver({ open: async () => first });
    const attempt = prover.start({ workspace: '/workspace', candidates: [row], signal: aborter.signal });
    await vi.waitFor(() => expect(first.control).toHaveBeenCalledOnce());
    aborter.abort();
    await expect(attempt.result).rejects.toThrow(/cleanup/i);
    await expect(attempt.settled).rejects.toThrow(/cleanup/i);
    expect(first.close).toHaveBeenCalledOnce();
    expect(() => prover.start({ workspace: '/workspace', candidates: [row] })).toThrow(/cleanup/i);
    pending.resolve(status);
  });

  it('faults after a normal close failure and refuses another attempt', async () => {
    const first = link();
    first.close.mockImplementation(() => { throw new Error('close failed'); });
    const prover = createWorkspaceDaemonProver({ open: async () => first });
    const attempt = prover.start({ workspace: '/workspace', candidates: [row] });
    await expect(attempt.result).rejects.toThrow(/cleanup/i);
    await expect(attempt.settled).rejects.toThrow(/cleanup/i);
    expect(() => prover.start({ workspace: '/workspace', candidates: [row] })).toThrow(/cleanup/i);
  });

  it('reports a late close failure after the proof deadline', async () => {
    const pending = deferred<ReturnType<typeof link>>();
    const prover = createWorkspaceDaemonProver({ open: () => pending.promise });
    const attempt = prover.start({ workspace: '/workspace', candidates: [row], timeoutMs: 20 });
    await expect(attempt.result).rejects.toThrow(/timed out/i);
    expect(() => prover.start({ workspace: '/workspace', candidates: [row] })).toThrow(/busy/i);
    const late = link();
    late.close.mockImplementation(() => { throw new Error('close failed'); });
    pending.resolve(late);
    await expect(attempt.settled).rejects.toThrow(/cleanup/i);
    expect(late.close).toHaveBeenCalledOnce();
    expect(() => prover.start({ workspace: '/workspace', candidates: [row] })).toThrow(/cleanup/i);
  });

  it('keeps the owner lease until the opened link reports actual closure', async () => {
    const closed = deferred<void>();
    const first = link();
    first.closed = closed.promise;
    const prover = createWorkspaceDaemonProver({ open: async () => first });
    const attempt = prover.start({ workspace: '/workspace', candidates: [row] });
    await vi.waitFor(() => expect(first.close).toHaveBeenCalledOnce());
    let settled = false;
    void attempt.settled.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(() => prover.start({ workspace: '/workspace', candidates: [row] })).toThrow(/busy/i);
    closed.resolve();
    await expect(attempt.result).resolves.toMatchObject({ id: row.id });
    await expect(attempt.settled).resolves.toBeUndefined();
  });

  it('signals a failed late close while holding the owner until the link actually closes', async () => {
    const aborter = new AbortController();
    const pending = deferred<ReturnType<typeof link>>();
    const closed = deferred<void>();
    const prover = createWorkspaceDaemonProver({ open: () => pending.promise });
    const attempt = prover.start({ workspace: '/workspace', candidates: [row], signal: aborter.signal });
    aborter.abort();
    await expect(attempt.result).rejects.toThrow(/cancelled/i);
    const late = link();
    late.closed = closed.promise;
    late.close.mockImplementation(() => { throw new Error('close failed'); });
    pending.resolve(late);
    await expect(attempt.failure).resolves.toMatchObject({ message: expect.stringMatching(/cleanup/i) });
    let settled = false;
    void attempt.settled.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(() => prover.start({ workspace: '/workspace', candidates: [row] })).toThrow(/cleanup/i);
    closed.resolve();
    await expect(attempt.settled).rejects.toThrow(/cleanup/i);
  });

  it('faults and holds the lease when closure confirmation is unavailable', async () => {
    const first = link();
    Object.assign(first, { closed: undefined });
    const prover = createWorkspaceDaemonProver({ open: async () => first });
    const attempt = prover.start({ workspace: '/workspace', candidates: [row], timeoutMs: 20 });
    await expect(attempt.failure).resolves.toMatchObject({ message: expect.stringMatching(/cleanup/i) });
    await expect(attempt.result).rejects.toThrow(/cleanup/i);
    let settled = false;
    void attempt.settled.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(first.close).toHaveBeenCalledOnce();
    expect(() => prover.start({ workspace: '/workspace', candidates: [row] })).toThrow(/cleanup/i);
  });

  it('faults and holds the lease when closure confirmation rejects', async () => {
    const first = link();
    first.closed = Promise.reject(new Error('closure unavailable'));
    const prover = createWorkspaceDaemonProver({ open: async () => first });
    const attempt = prover.start({ workspace: '/workspace', candidates: [row], timeoutMs: 20 });
    await expect(attempt.failure).resolves.toMatchObject({ message: expect.stringMatching(/cleanup/i) });
    await expect(attempt.result).rejects.toThrow(/cleanup/i);
    let settled = false;
    void attempt.settled.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(first.close).toHaveBeenCalledOnce();
  });

});
