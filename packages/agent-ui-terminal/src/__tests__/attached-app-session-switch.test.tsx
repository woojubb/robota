/**
 * #3189: the full App on a wire channel. The session picker lists the host's sessions, and choosing
 * one asks the host to switch instead of building a new channel.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { render } from 'ink-testing-library';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App.js';
import { WireTuiChannel } from '../wire-tui-channel.js';

import type { IAttachedSessionConnection } from '../attached-session-connection.js';
import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport/client';

const TICK_MS = 30;
const FRAME_DEADLINE_MS = 3000;

function tick(ms = TICK_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, describeFailure: () => string): Promise<void> {
  const deadline = Date.now() + FRAME_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await tick(10);
  }
  throw new Error(`waitFor timeout\n${describeFailure()}`);
}

function scriptedConnection(): IAttachedSessionConnection & {
  sent: TClientMessage[];
  push: (message: TServerMessage) => void;
} {
  const listeners = new Set<(message: TServerMessage) => void>();
  const sent: TClientMessage[] = [];
  return {
    sent,
    send: (message) => {
      sent.push(message);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onClose: () => () => undefined,
    push: (message) => {
      for (const listener of [...listeners]) listener(message);
    },
  };
}

function cliAdapter(settingsPath: string): ITuiCliAdapter {
  return {
    getUserSettingsPath: () => settingsPath,
    readSettings: () => ({}),
    reloadPluginCommandSource: vi.fn(),
    applyActiveModelChange: vi.fn().mockReturnValue({ applied: true }),
    getGitBranch: vi.fn().mockReturnValue(undefined),
    getProviderDisplayName: vi.fn((type: string) => type),
  };
}

function lastListRequestId(sent: readonly TClientMessage[]): string {
  const requests = sent.filter(
    (message): message is Extract<TClientMessage, { type: 'list-sessions' }> =>
      message.type === 'list-sessions',
  );
  return requests.at(-1)?.requestId ?? '';
}

describe('the full App attached to a host over the wire', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-attached-app-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("lists the host's sessions in the picker and asks the host to switch", async () => {
    const link = scriptedConnection();
    const channel = new WireTuiChannel({ connection: link, driverId: 'attach:1' });
    const createChannel = vi.fn(() => channel);
    const view = render(
      <App
        cwd={cwd}
        createChannel={createChannel}
        requestSessionSwitch={(sessionId) => channel.requestSessionSwitch(sessionId)}
        cliAdapter={cliAdapter(join(cwd, 'settings.json'))}
      />,
    );
    try {
      await waitFor(
        () => link.sent.some((message) => message.type === 'list-sessions'),
        () => JSON.stringify(link.sent),
      );
      // `/resume` ran on the host, which routes the picker back to this terminal only.
      link.push({
        type: 'ui_intent',
        event: { intent: { type: 'show-session-picker' }, requesterDriverId: 'attach:1' },
      });
      link.push({
        type: 'sessions',
        requestId: lastListRequestId(link.sent),
        listing: {
          currentSessionId: 'host-current',
          sessions: [
            {
              id: 'host-other-session',
              name: 'Host session',
              cwd,
              updatedAt: '2026-09-26T10:00:00.000Z',
              messageCount: 4,
              preview: 'kept by the daemon',
            },
          ],
          unreadableSessionIds: [],
        },
      });
      await waitFor(
        () => (view.lastFrame() ?? '').includes('Host session'),
        () => view.lastFrame() ?? '<none>',
      );
      expect(view.lastFrame()).toContain('Select a session to resume');
      await tick();

      link.sent.length = 0;
      view.stdin.write('\r');
      await waitFor(
        () => link.sent.some((message) => message.type === 'switch-session'),
        () => JSON.stringify(link.sent),
      );
      expect(link.sent).toContainEqual({ type: 'switch-session', sessionId: 'host-other-session' });
      // The App keeps its channel; the host's `session_switched` is what moves it.
      expect(createChannel).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      await channel.stop();
    }
  });
});
