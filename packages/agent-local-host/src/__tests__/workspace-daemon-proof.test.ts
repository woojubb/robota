import { describe, expect, it, vi } from 'vitest';

import { createWorkspaceDaemonProver } from '../workspace-daemon-proof.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const row = { id: 'runtime', generation: 'generation', liveness: 'alive', control: 'available', activity: 'idle' } as const;
const status = { status: 'running', daemon: true, cwd: '/workspace' } as const;
const link = () => ({ control: vi.fn(async (): Promise<Readonly<Record<string, unknown>>> => status), close: vi.fn() });

function proveWorkspaceDaemon(options: Parameters<ReturnType<typeof createWorkspaceDaemonProver>['start']>[0] & Parameters<typeof createWorkspaceDaemonProver>[0]) {
  const { open, ...input } = options;
  return createWorkspaceDaemonProver({ open }).start(input).result;
}

describe('authenticated workspace daemon proof', () => {
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

});
