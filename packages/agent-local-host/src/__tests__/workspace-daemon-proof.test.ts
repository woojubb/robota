import { describe, expect, it, vi } from 'vitest';

import { proveWorkspaceDaemon } from '../workspace-daemon-proof.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const row = { id: 'runtime', generation: 'generation', liveness: 'alive', control: 'available', activity: 'idle' } as const;
const status = { status: 'running', daemon: true, cwd: '/workspace' } as const;
const link = () => ({ control: vi.fn(async (): Promise<Readonly<Record<string, unknown>>> => status), close: vi.fn() });

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
      candidates: [row] })).rejects.toThrow(/unproven/i);
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
});
