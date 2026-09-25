import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { ConnectionAuthority } from '@robota-sdk/agent-interface-session-mobility';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';

import type { TScriptedTurn } from '@robota-sdk/agent-core/testing';
import type { TPeerReach } from '@robota-sdk/agent-core';

/**
 * A task another of the user's devices delegates runs under this session's own policy: the operator
 * here approves the request, and what the task may then do is what a peer from that place may do
 * here — never what the sender asked for.
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
  // The operator here says yes to everything asked: what is refused below is refused by policy.
  session.on('permission_request', (request) => session.resolvePermission(request.id, true));
  return { session, chatOptions: scripted.chatOptions };
}

async function delegate(reach: TPeerReach, session: InteractiveSession): Promise<void> {
  const authority = new ConnectionAuthority(
    { deviceId: 'A', sessionId: 'A', locality: reach, capabilities: ['delegate'] },
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
  it('cannot write on a same-host receiver whose policy does not let peers change anything', async () => {
    const { session } = receiver([
      {
        toolCalls: [{ name: 'Write', args: { filePath: join(workspace, 'x.txt'), content: 'x' } }],
      },
      { text: 'done' },
    ]);
    try {
      await delegate('same-host', session);
      expect(existsSync(join(workspace, 'x.txt'))).toBe(false);
    } finally {
      await session.shutdown();
    }
  });

  it('is offered no tool but the reply when it comes from another host', async () => {
    const { session, chatOptions } = receiver([{ text: 'done' }]);
    try {
      await delegate('another-host', session);
      expect((chatOptions[0]?.tools ?? []).map((tool) => tool.name)).toEqual(['peer_reply']);
    } finally {
      await session.shutdown();
    }
  });
});
