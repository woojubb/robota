import React from 'react';
import { Text } from 'ink';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAppInputBindings } from '../useAppInputBindings.js';

type TOptions = Parameters<typeof useAppInputBindings>[0];

function Probe({ options }: { options: TOptions }): React.ReactElement {
  useAppInputBindings(options);
  return <Text>ready</Text>;
}

function options(overrides: Partial<TOptions> = {}): TOptions {
  return {
    isThinking: false,
    isShuttingDown: false,
    readOnly: false,
    attached: false,
    permissionRequest: null,
    pendingUserAction: null,
    pluginVisible: false,
    transportVisible: false,
    sessionPickerVisible: false,
    workspaceSwitcherVisible: false,
    historySearchOpen: false,
    themePickerVisible: false,
    selectedEntry: undefined,
    backgroundListFocused: false,
    mainThreadEntryId: undefined,
    activeTools: [],
    abort: vi.fn(),
    stopWaitingLoop: vi.fn().mockResolvedValue(undefined),
    toggleWorkspaceSwitcher: vi.fn(),
    selectWorkspaceEntry: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    recoveryError: undefined,
    recoveryPending: false,
    coordinationBlocked: false,
    retryRecovery: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe('Esc for a waiting self-paced loop', () => {
  it('routes idle Esc to targeted loop stop, but active-turn Esc to abort', async () => {
    const idle = options();
    const idleView = render(<Probe options={idle} />);
    idleView.stdin.write('\u001b');
    await vi.waitFor(() => expect(idle.stopWaitingLoop).toHaveBeenCalledOnce());
    expect(idle.abort).not.toHaveBeenCalled();
    idleView.unmount();

    const thinking = options({ isThinking: true });
    const thinkingView = render(<Probe options={thinking} />);
    thinkingView.stdin.write('\u001b');
    await vi.waitFor(() => expect(thinking.abort).toHaveBeenCalledOnce());
    expect(thinking.stopWaitingLoop).not.toHaveBeenCalled();
  });

  it('keeps list-focus and overlay Esc with their owning surfaces', async () => {
    for (const blocked of [
      options({ backgroundListFocused: true }),
      options({ historySearchOpen: true }),
    ]) {
      const view = render(<Probe options={blocked} />);
      view.stdin.write('\u001b');
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(blocked.stopWaitingLoop).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('stops nothing on an observing terminal: neither the turn nor the loop', async () => {
    for (const observing of [options({ readOnly: true }), options({ readOnly: true, isThinking: true })]) {
      const view = render(<Probe options={observing} />);
      view.stdin.write('\u001b');
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      expect(observing.stopWaitingLoop).not.toHaveBeenCalled();
      expect(observing.abort).not.toHaveBeenCalled();
      view.unmount();
    }
  });
});
