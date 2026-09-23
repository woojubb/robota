/**
 * SCREEN-014 regression: the workspace callbacks must keep a stable identity across re-renders.
 *
 * A fresh `readExecutionWorkspaceDetail` closure every render made App's detail-loading `useEffect`
 * re-run on every render and `setState`-loop ("Maximum update depth exceeded") the moment a
 * background entry was selected. This test pins the callbacks to a stable identity.
 */
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { useTuiChannel } from '../useTuiChannel.js';

import type { ITuiAppChannelPort } from '../../tui-app-channel-port.js';

function makeFakeChannel(): ITuiAppChannelPort & { emitChange: () => void } {
  const manager = {
    history: [],
    streamingText: '',
    activeTools: [],
    isThinking: false,
    isAborting: false,
    pendingPrompt: null,
    executionWorkspaceSnapshot: null,
    selectedExecutionEntryId: undefined,
    contextState: { percentage: 0, usedTokens: 0, maxTokens: 100_000 },
    addEntry: () => undefined,
  };
  let onChange: (() => void) | null = null;
  return {
    terminalHandoffController: undefined,
    sessionName: undefined,
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    subscribe: (handler) => {
      onChange = handler;
      return () => {
        if (onChange === handler) onChange = null;
      };
    },
    emitChange: () => onChange?.(),
    getSnapshot: () => ({
      ...manager,
      lastErrorMessage: null,
      isStalled: false,
      sessionEventNotices: [],
      isShuttingDown: false,
      pendingCount: 0,
      permissionRequest: null,
      pendingUserAction: null,
    }),
    getSessionUiEventPort: () => ({ on: () => undefined, off: () => undefined }),
    getCommandQueryPort: () => ({ getCommands: () => [], getSubcommands: () => [] }),
    getRuntimeStatusSnapshot: (permissionMode) => ({ permissionMode, sessionId: '' }),
    addEntry: manager.addEntry,
    handleInput: () => Promise.resolve(),
    abort: () => undefined,
    cancelQueue: () => undefined,
    stopWaitingSelfPacedLoop: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
    selectExecutionWorkspaceEntry: () => undefined,
    readExecutionWorkspaceDetail: () => Promise.resolve({ entryId: 'x', records: [] }),
    sendAgentJob: () => Promise.resolve(),
    resolveUserAction: () => undefined,
  };
}

async function tick(ms = 25): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('useTuiChannel callback stability (SCREEN-014 regression)', () => {
  it('keeps readExecutionWorkspaceDetail + selectExecutionWorkspaceEntry stable across re-renders', async () => {
    const channel = makeFakeChannel();
    const seen: Array<{ read: unknown; select: unknown }> = [];

    function Probe(): React.ReactElement | null {
      const state = useTuiChannel(channel);
      seen.push({
        read: state.readExecutionWorkspaceDetail,
        select: state.selectExecutionWorkspaceEntry,
      });
      return null;
    }

    render(<Probe />);
    await tick();

    // Force a re-render the way the channel does on every state change.
    channel.emitChange();
    channel.emitChange();
    await tick();

    expect(seen.length).toBeGreaterThanOrEqual(2);
    const first = seen[0]!;
    const last = seen[seen.length - 1]!;
    expect(last.read).toBe(first.read);
    expect(last.select).toBe(first.select);
  });
});
