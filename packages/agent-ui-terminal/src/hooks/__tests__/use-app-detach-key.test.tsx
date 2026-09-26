/**
 * Ctrl-] detaches a terminal attached to a session a host runs, exactly like Ctrl-C and `/exit`
 * there. A terminal running its own session has nothing to detach from, so the key does nothing.
 */

import React from 'react';
import { Text } from 'ink';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAppInputBindings } from '../useAppInputBindings.js';

type TOptions = Parameters<typeof useAppInputBindings>[0];

const CTRL_RIGHT_BRACKET = '\x1d';

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

describe('Ctrl-] detach', () => {
  it('leaves an attached terminal the way Ctrl-C does, driving or observing', async () => {
    for (const attached of [options({ attached: true }), options({ attached: true, readOnly: true })]) {
      const view = render(<Probe options={attached} />);
      view.stdin.write(CTRL_RIGHT_BRACKET);
      await vi.waitFor(() => expect(attached.shutdown).toHaveBeenCalledWith('prompt_input_exit'));
      view.unmount();
    }
  });

  it('does nothing on a terminal running its own session', async () => {
    const own = options();
    const view = render(<Probe options={own} />);
    view.stdin.write(CTRL_RIGHT_BRACKET);
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    expect(own.shutdown).not.toHaveBeenCalled();
  });
});
