import { describe, expect, it, vi } from 'vitest';

import { createPeerSendFileTool, type IPeerSendFilePort } from '../peer-send-file-tool.js';
import { FRAMEWORK_TOOL_PERMISSION_PROFILES } from '../tool-permission-profiles.js';

/** What a call produced, whether the tool returned or threw. */
async function outcome(port: IPeerSendFilePort): Promise<string> {
  const tool = createPeerSendFileTool(port) as unknown as {
    execute(args: Record<string, unknown>): Promise<unknown>;
  };
  try {
    return JSON.stringify(await tool.execute({ session: 'A', path: 'report.md' }));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function port(over: Partial<IPeerSendFilePort> = {}): IPeerSendFilePort & {
  send: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn(async () => ({ state: 'delivered' as const }));
  const confirm = vi.fn(async () => true);
  return {
    send,
    confirm,
    activeTurn: () => undefined,
    cwd: () => '/workspace',
    prepare: () => async () => ({
      ok: true as const,
      file: { path: '/workspace/report.md', size: 9, sha256: 'd'.repeat(64), send },
    }),
    ...over,
  } as IPeerSendFilePort & {
    send: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
  };
}

describe('peer_send_file', () => {
  it('asks the operator on every call, with path, size, hash and destination', async () => {
    const p = port();
    await outcome(p);
    await outcome(p);
    expect(p.confirm).toHaveBeenCalledTimes(2);
    expect(p.confirm).toHaveBeenCalledWith({
      path: '/workspace/report.md',
      size: 9,
      sha256: 'd'.repeat(64),
      to: 'A',
    });
    expect(p.send).toHaveBeenCalledTimes(2);
  });

  it('sends nothing without the operator yes', async () => {
    const p = port();
    p.confirm.mockResolvedValue(false);
    expect(await outcome(p)).toMatch(/did not allow/);
    expect(p.send).not.toHaveBeenCalled();
  });

  it('refuses in a turn a peer message started, before anything is read or asked', async () => {
    const prepare = vi.fn();
    const p = port({
      activeTurn: () => ({ messageId: 'm-1', replyTo: 'A' }),
      prepare: () => prepare,
    });
    expect(await outcome(p)).toMatch(/cannot send files/);
    expect(prepare).not.toHaveBeenCalled();
    expect(p.confirm).not.toHaveBeenCalled();
    expect(p.send).not.toHaveBeenCalled();
  });

  it('passes on what the host refuses to let the model send', async () => {
    const p = port({
      prepare: () => async () => ({ ok: false as const, reason: 'outside the workspace' }),
    });
    expect(await outcome(p)).toMatch(/outside the workspace/);
    expect(p.confirm).not.toHaveBeenCalled();
  });

  it('is kept out of peer turns by the permission profile', () => {
    expect(FRAMEWORK_TOOL_PERMISSION_PROFILES['peer_send_file']?.notInPeerTurn).toBe(true);
  });
});
