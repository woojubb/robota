import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { ConnectionAuthority } from '@robota-sdk/agent-interface-session-mobility';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';

import type { TScriptedTurn } from '@robota-sdk/agent-core/testing';

/**
 * A task another of the user's devices delegates runs under this session's ordinary permissions: the
 * operator here approves the request, and what the task then does is decided exactly like the
 * session's own work — never by what the sender asked for.
 */

let workspace: string;

beforeEach(() => {
  workspace = join(realpathSync(mkdtempSync(join(tmpdir(), 'delegated-'))), 'project');
  mkdirSync(workspace, { recursive: true });
});

afterEach(() => rmSync(join(workspace, '..'), { recursive: true, force: true }));

function receiver(turns: readonly TScriptedTurn[]) {
  const scripted = createScriptedProvider(turns);
  const session = new InteractiveSession({
    cwd: workspace,
    provider: scripted.provider,
    bare: true,
    commandHostAdapters: {
      localPeers: {
        list: () => [],
        ownSessionId: () => 'B',
        send: vi.fn(async () => ({ state: 'pending' as const })),
      },
    },
  });
  const asked: Array<[string, string | undefined]> = [];
  // The operator here declines every tool call asked about.
  session.on('permission_request', (request) => {
    asked.push([request.toolName, request.requesterDriverId]);
    session.resolvePermission(request.id, false);
  });
  return { session, asked };
}

async function delegate(session: InteractiveSession): Promise<void> {
  const authority = new ConnectionAuthority(
    { deviceId: 'A', sessionId: 'A', locality: 'another-host', capabilities: ['delegate'] },
    { approve: async () => true },
  );
  const decision = await authority.authorizeDelegation({
    requestId: 'task-1',
    task: `write ${join(workspace, 'x.txt')}`,
    // What the sender asks for beyond the task is not honoured.
    permissionMode: 'bypassPermissions',
    allowedTools: ['Write', 'Bash'],
  } as never);
  if (!decision.allowed) throw new Error(`delegation refused: ${decision.reason}`);
  const handle = await session.submit(
    decision.turn.input,
    undefined,
    undefined,
    decision.turn.options,
  );
  await handle.completed;
}

describe('a delegated task', () => {
  it('asks this operator before a write, whatever mode the sender asked for', async () => {
    const { session, asked } = receiver([
      {
        toolCalls: [{ name: 'Write', args: { filePath: join(workspace, 'x.txt'), content: 'x' } }],
      },
      { text: 'done' },
    ]);
    try {
      await delegate(session);
      expect(asked).toEqual([['Write', 'peer:A']]);
      expect(existsSync(join(workspace, 'x.txt'))).toBe(false);
    } finally {
      await session.shutdown();
    }
  });
});
