/**
 * The app tells the renderer when keys can be delivered: once the channel's start has settled,
 * whether it succeeded or failed, because after a failure the person still has to be able to leave.
 */
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { InputReadinessProvider } from '../../input-readiness-context.js';
import { useAppLifecycleState } from '../useAppLifecycleState.js';

import type { ITuiAppChannelPort } from '../../tui-app-channel-port.js';

function channelStarting(start: () => Promise<void>): ITuiAppChannelPort {
  return {
    terminalHandoffController: undefined,
    sessionName: undefined,
    start,
  } as unknown as ITuiAppChannelPort;
}

function Probe({ channel }: { channel: ITuiAppChannelPort }): null {
  useAppLifecycleState(channel);
  return null;
}

function mount(channel: ITuiAppChannelPort, onReady: () => void) {
  return render(
    <InputReadinessProvider onReady={onReady}>
      <Probe channel={channel} />
    </InputReadinessProvider>,
  );
}

describe('useAppLifecycleState input readiness', () => {
  it('signals when the start has succeeded, and not while it is pending', async () => {
    let finish: () => void = () => undefined;
    const onReady = vi.fn();
    const view = mount(
      channelStarting(() => new Promise<void>((resolve) => (finish = resolve))),
      onReady,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onReady).not.toHaveBeenCalled();

    finish();
    await vi.waitFor(() => expect(onReady).toHaveBeenCalled());
    view.unmount();
  });

  it('signals when the start has failed', async () => {
    const onReady = vi.fn();
    const view = mount(
      channelStarting(() => Promise.reject(new Error('no session'))),
      onReady,
    );
    await vi.waitFor(() => expect(onReady).toHaveBeenCalled());
    view.unmount();
  });
});
