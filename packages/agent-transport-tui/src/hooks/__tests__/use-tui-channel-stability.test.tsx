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

import type { TuiInteractionChannel } from '../../TuiInteractionChannel.js';

function makeFakeChannel(): TuiInteractionChannel {
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
  const fake = {
    onChange: null as (() => void) | null,
    stateManager: manager,
    isShuttingDown: false,
    permissionRequest: null,
    pendingUserAction: null,
    getSession: () => ({}),
    getRegistry: () => ({}),
    getCommandEffectQueue: () => ({}),
    handleInput: () => undefined,
    abort: () => undefined,
    cancelQueue: () => undefined,
    shutdown: () => Promise.resolve(),
    selectExecutionWorkspaceEntry: () => undefined,
    readExecutionWorkspaceDetail: () => Promise.resolve({ entryId: 'x', records: [] }),
  };
  return fake as unknown as TuiInteractionChannel;
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
    channel.onChange?.();
    channel.onChange?.();
    await tick();

    expect(seen.length).toBeGreaterThanOrEqual(2);
    const first = seen[0]!;
    const last = seen[seen.length - 1]!;
    expect(last.read).toBe(first.read);
    expect(last.select).toBe(first.select);
  });
});
