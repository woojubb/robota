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

  async function resumeAgainst(
    answer: (requestId: string) => TServerMessage,
    notice: string,
  ): Promise<string> {
    const link = scriptedConnection();
    const channel = new WireTuiChannel({ connection: link, driverId: 'attach:1' });
    const view = render(
      <App
        cwd={cwd}
        createChannel={() => channel}
        requestSessionSwitch={(sessionId) => channel.requestSessionSwitch(sessionId)}
        cliAdapter={cliAdapter(join(cwd, 'settings.json'))}
      />,
    );
    try {
      await waitFor(
        () => (view.lastFrame() ?? '').includes('Type a message'),
        () => view.lastFrame() ?? '<none>',
      );
      link.sent.length = 0;
      link.push({
        type: 'ui_intent',
        event: { intent: { type: 'show-session-picker' }, requesterDriverId: 'attach:1' },
      });
      link.push(answer(lastListRequestId(link.sent)));
      await waitFor(
        () => (view.lastFrame() ?? '').includes(notice),
        () => view.lastFrame() ?? '<none>',
      );
      await tick();
      return view.lastFrame() ?? '';
    } finally {
      view.unmount();
      await channel.stop();
    }
  }

  it('gives the prompt back with the reason when the host cannot list its sessions', async () => {
    const frame = await resumeAgainst(
      (requestId) => ({
        type: 'sessions_error',
        requestId,
        code: 'not_available',
        message: 'Session listing is not available on this host.',
      }),
      'Session listing is not available on this host.',
    );
    expect(frame).not.toContain('Select a session to resume');
    expect(frame).not.toContain('Waiting for response');
    expect(frame).toContain('Type a message');
  });

  it("prints the new session's transcript when the switch and its history arrive together", async () => {
    const link = scriptedConnection();
    const channel = new WireTuiChannel({ connection: link, driverId: 'attach:1' });
    const view = render(
      <App
        cwd={cwd}
        createChannel={() => channel}
        requestSessionSwitch={(sessionId) => channel.requestSessionSwitch(sessionId)}
        cliAdapter={cliAdapter(join(cwd, 'settings.json'))}
      />,
    );
    const entry = (id: string, content: string) => ({
      id,
      timestamp: '2026-09-26T10:00:00.000Z',
      category: 'chat',
      type: 'user',
      data: { id: `m-${id}`, role: 'user', content, state: 'complete' },
    });
    try {
      await waitFor(
        () => link.sent.some((message) => message.type === 'get-history'),
        () => JSON.stringify(link.sent),
      );
      link.push({
        type: 'history',
        startIndex: 0,
        total: 3,
        entries: [entry('o1', 'old one'), entry('o2', 'old two'), entry('o3', 'old three')],
      });
      await waitFor(
        () => (view.lastFrame() ?? '').includes('old three'),
        () => view.lastFrame() ?? '<none>',
      );
      // One chunk from the host: the switch and the new session's history, handled in one pass.
      link.push({ type: 'session_switched', event: { sessionId: 'session-2' } });
      link.push({
        type: 'history',
        startIndex: 0,
        total: 1,
        entries: [entry('n1', 'new session prompt')],
      });
      await waitFor(
        () => (view.lastFrame() ?? '').includes('new session prompt'),
        () => view.lastFrame() ?? '<none>',
      );
      expect(view.lastFrame()).toContain('Switched to session session-2.');
    } finally {
      view.unmount();
      await channel.stop();
    }
  });

  it('opens no empty picker when the host has no sessions to resume', async () => {
    const frame = await resumeAgainst(
      (requestId) => ({
        type: 'sessions',
        requestId,
        listing: { currentSessionId: 'host-current', sessions: [], unreadableSessionIds: [] },
      }),
      'No saved sessions to resume',
    );
    expect(frame).not.toContain('Select a session to resume');
    expect(frame).not.toContain('Waiting for response');
    expect(frame).toContain('Type a message');
  });
});
