import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ current: true, receive: undefined as undefined | ((message: unknown) => void) }));
vi.mock('../../secure/workspace-root-fence.js', () => ({
  SecureWorkspaceRootFence: class {
    assertCurrent() { if (!state.current) throw new Error('Workspace root changed.'); }
    proof() { this.assertCurrent(); return { tag: 'root', generation: 1, trustTag: 'untrusted' }; }
    close() {}
  },
}));

const link = vi.hoisted(() => {
  let close!: () => void;
  const closed = new Promise<void>((resolve) => { close = resolve; });
  return {
    custody: { unlocked: false },
    session: { onMessage: vi.fn((listener: (message: unknown) => void) => { state.receive = listener; return () => { state.receive = undefined; }; }), send: vi.fn() },
    control: vi.fn(async (request: { command: string }) => request.command === 'workspace-root-proof'
      ? { status: 'root-proof', tag: 'root', generation: 1, trustTag: 'untrusted' }
      : { status: 'attached', driverId: 'driver' }),
    unlock: vi.fn(async () => 'verified'),
    revokeToCleanup: vi.fn(), lock: vi.fn(async () => {}), close: vi.fn(() => close()), closed,
  };
});
vi.mock('../owner-link-client.js', () => ({ openPreparedOwnerLink: async () => ({ link, grantNeeded: true }) }));

import { openSecureAttach } from '../secure-attach-client.js';

it('drops a buffered private frame when the root changes before subscription', async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'secure-buffer-')));
  try {
    const attached = await openSecureAttach({ root: workspace, id: 'runtime', generation: 'generation',
      workspace, brokerEndpoint: 'synthetic', mode: 'observe', handover: {} as never });
    state.receive?.({ type: 'error', message: 'private frame' });
    state.current = false;
    const delivered = vi.fn();
    expect(() => attached.subscribe(delivered)).toThrow('Workspace root changed.');
    expect(delivered).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(link.lock).toHaveBeenCalledWith('fault'));
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});
