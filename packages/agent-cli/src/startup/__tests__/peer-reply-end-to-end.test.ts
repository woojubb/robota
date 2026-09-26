/**
 * Two live sessions on one host, over the real carrier: the operator of A messages B, B's agent
 * answers with `peer_reply`, and the answer arrives at A — which was idle — as a peer turn threaded
 * to the message it answers.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { attachLocalPeerMessaging } from '../host-action-adapters.js';

import type { ILocalPeerPresence } from '../../remote-control/local-peer-presence.js';
import type { TScriptedTurn } from '@robota-sdk/agent-core/testing';
import type { ICommandHostAdapters } from '@robota-sdk/agent-framework';

let root: string;
let guardedDirectory: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'peer-e2e-')));
  guardedDirectory = path.join(root, 'rendezvous');
  mkdirSync(guardedDirectory, { mode: 0o700 });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function presence(sessionId: string): ILocalPeerPresence {
  return {
    sessionId,
    guardedDirectory,
    list: () =>
      [
        { sessionId: 'A', liveness: 'alive', pid: 1 },
        { sessionId: 'B', liveness: 'alive', pid: 2 },
      ] as never,
    listWithWorkspace: async () => [],
    relate: async () => undefined,
    refreshWorkspace: async () => {},
    publishStatus: () => {},
    withdraw: () => {},
  };
}

async function liveSession(sessionId: string, turns: readonly TScriptedTurn[]) {
  const workspace = path.join(root, sessionId);
  mkdirSync(workspace);
  const scripted = createScriptedProvider(turns);
  const adapters: ICommandHostAdapters = {
    localPeers: { list: () => [], ownSessionId: () => sessionId },
  };
  const session = new InteractiveSession({
    cwd: workspace,
    provider: scripted.provider,
    bare: true,
    commandHostAdapters: adapters,
  });
  // The operator allows what is asked: the reply is decided like any call that leaves the machine.
  const asked: string[] = [];
  session.on('permission_request', (request) => {
    asked.push(request.toolName);
    session.resolvePermission(request.id, true);
  });
  const report = { said: [] as string[], writeError: (m: string) => report.said.push(m) };
  const messaging = await attachLocalPeerMessaging(
    adapters,
    presence(sessionId),
    () => session,
    report,
  );
  return { session, adapters, scripted, messaging, report, asked };
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !condition(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('peer_reply end to end', () => {
  it('delivers B’s answer to A, idle, as a peer turn', async () => {
    const a = await liveSession('A', [{ text: 'thanks' }]);
    const b = await liveSession('B', [
      { toolCalls: [{ name: 'peer_reply', args: { text: 'pong from B' } }] },
      { text: 'answered' },
    ]);
    try {
      const ack = await a.adapters.localPeers?.send?.('B', 'ping from A');
      expect(ack?.state).toBe('pending');

      await until(() => a.scripted.requests.length > 0);

      const seenByA = JSON.stringify(a.scripted.requests[0]);
      expect(seenByA).toContain('<peer_message from=\\"peer:B\\">\\npong from B');
      // B was told only what A's operator wrote, and answered with the tool rather than its text.
      expect(JSON.stringify(b.scripted.requests[0])).toContain('ping from A');
      expect(seenByA).not.toContain('answered');
      expect(b.asked).toEqual(['peer_reply']);
      expect([...a.report.said, ...b.report.said]).toEqual([]);
    } finally {
      await (await a.messaging)?.close();
      await (await b.messaging)?.close();
      await a.session.shutdown();
      await b.session.shutdown();
    }
  });
});
