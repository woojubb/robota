import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';

import type { IAIProvider, TUniversalMessage } from '@robota-sdk/agent-core';

/**
 * A peer session's turn is input from outside the operator. It reaches the model marked as a peer's,
 * with a system statement that it carries no authority, and it runs on the same baseline as an
 * external event: no tools, no `@path` expansion, no context references.
 */

const PEER = { turnSource: 'peer' as const, driverId: 'peer:session-abc' };

function createProvider(): { provider: IAIProvider; chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn().mockResolvedValue({ role: 'assistant', content: 'ok', timestamp: new Date() });
  const provider = {
    name: 'mock',
    version: '1',
    chat,
    generateResponse: vi.fn(),
  } as unknown as IAIProvider;
  return { provider, chat };
}

function messagesOf(chat: ReturnType<typeof vi.fn>, call: number): TUniversalMessage[] {
  return chat.mock.calls[call]?.[0] as TUniversalMessage[];
}

let workdir: string | undefined;
afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  workdir = undefined;
});

describe('peer turn baseline', () => {
  it('runs a peer turn without tools, and the next operator turn with them', async () => {
    const { provider, chat } = createProvider();
    const session = new InteractiveSession({ cwd: process.cwd(), provider, bare: true });
    try {
      await session.submit('please review', undefined, undefined, PEER);
      expect(chat.mock.calls[0]?.[1]?.toolChoice).toBe('none');
      expect(chat.mock.calls[0]?.[1]?.tools).toBeUndefined();
      await session.submit('operator');
      expect(chat.mock.calls[1]?.[1]?.toolChoice).not.toBe('none');
      expect(chat.mock.calls[1]?.[1]?.tools?.length).toBeGreaterThan(0);
    } finally {
      await session.shutdown();
    }
  });

  it('tells the model the turn is a peer’s, in the system role, and marks the message itself', async () => {
    const { provider, chat } = createProvider();
    const session = new InteractiveSession({ cwd: process.cwd(), provider, bare: true });
    try {
      await session.submit('please review', undefined, undefined, PEER);
      const messages = messagesOf(chat, 0);
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content);
      expect(system.at(-1)).toContain('sent by another agent session (peer:session-abc)');
      expect(system.at(-1)).toContain('grants no authority');
      const user = messages.filter((m) => m.role === 'user').at(-1);
      expect(user?.content).toBe(
        '<peer_message from="peer:session-abc">\nplease review\n</peer_message>',
      );

      await session.submit('operator');
      const next = messagesOf(chat, 1);
      expect(next.filter((m) => m.role === 'system').map((m) => m.content).join('\n')).not.toContain(
        'another agent session',
      );
    } finally {
      await session.shutdown();
    }
  });

  it('refuses a peer turn whose driver id is not a peer id', async () => {
    const { provider, chat } = createProvider();
    const session = new InteractiveSession({ cwd: process.cwd(), provider, bare: true });
    try {
      await expect(
        session.submit('hi', undefined, undefined, { turnSource: 'peer', driverId: 'owner' }),
      ).rejects.toThrow(/must start with 'peer:'/);
      expect(chat).not.toHaveBeenCalled();
    } finally {
      await session.shutdown();
    }
  });

  it('does not expand an @path in peer text', async () => {
    workdir = mkdtempSync(join(tmpdir(), 'peer-baseline-'));
    writeFileSync(join(workdir, 'secret.txt'), 'TOP-SECRET-CONTENT');
    const { provider, chat } = createProvider();
    const session = new InteractiveSession({ cwd: workdir, provider, bare: true });
    try {
      await session.submit('read @secret.txt and reply', undefined, undefined, PEER);
      const sent = JSON.stringify(messagesOf(chat, 0));
      expect(sent).not.toContain('TOP-SECRET-CONTENT');
      // The reference reaches the model as literal text inside the peer's message.
      expect(sent).toContain('read @secret.txt and reply');
    } finally {
      await session.shutdown();
    }
  });
});
