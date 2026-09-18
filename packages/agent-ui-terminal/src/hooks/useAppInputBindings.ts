import { useApp, useInput } from 'ink';
import { useEffect } from 'react';

import { useKeybindingActions } from '../keybindings/keybindings-context.js';
import { useScreenReader } from '../screen-reader-context.js';
import { handleInterrupt } from '../shutdown-signal.js';
import { useScreenReaderTurnSignals } from './useScreenReaderTurnSignals.js';

import type { IPendingPermissionRequest } from '../types.js';
import type { IActionRequest, TSessionEndReason } from '@robota-sdk/agent-core';
import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';
import type { IToolState } from '@robota-sdk/agent-interface-session';

interface IOptions {
  readonly isThinking: boolean;
  readonly isShuttingDown: boolean;
  readonly permissionRequest: IPendingPermissionRequest | null;
  readonly pendingUserAction: IActionRequest | null;
  readonly pluginVisible: boolean;
  readonly transportVisible: boolean;
  readonly sessionPickerVisible: boolean;
  readonly workspaceSwitcherVisible: boolean;
  readonly selectedEntry: IExecutionWorkspaceEntry | undefined;
  readonly mainThreadEntryId: string | undefined;
  readonly activeTools: readonly IToolState[];
  readonly abort: () => void;
  readonly toggleWorkspaceSwitcher: () => void;
  readonly selectWorkspaceEntry: (entryId: string) => void;
  readonly shutdown: (reason?: TSessionEndReason) => Promise<void>;
  readonly recoveryError: string | undefined;
  readonly recoveryPending: boolean;
  readonly coordinationBlocked: boolean;
  readonly retryRecovery: () => void;
}

function overlaysBlockKeys(options: IOptions): boolean {
  return Boolean(
    options.permissionRequest ||
    options.pendingUserAction ||
    options.pluginVisible ||
    options.transportVisible ||
    options.sessionPickerVisible ||
    options.workspaceSwitcherVisible ||
    options.coordinationBlocked,
  );
}

function useEscapeBindings(options: IOptions): void {
  const context = options.isThinking ? 'thinking' : 'background-detail';
  useKeybindingActions(context, (actions) => {
    if (overlaysBlockKeys(options)) return;
    if (actions.includes('abort') && options.isThinking) {
      options.abort();
      return;
    }
    const selected = options.selectedEntry;
    if (
      actions.includes('return-to-main') &&
      selected &&
      selected.kind !== 'main_thread' &&
      options.mainThreadEntryId
    ) {
      options.selectWorkspaceEntry(options.mainThreadEntryId);
    }
  });
}

function useWorkspaceSwitcherBinding(options: IOptions): void {
  useKeybindingActions('app', (actions) => {
    if (!actions.includes('open-workspace-switcher')) return;
    if (
      options.permissionRequest ||
      options.pendingUserAction ||
      options.pluginVisible ||
      options.sessionPickerVisible ||
      options.coordinationBlocked ||
      options.isShuttingDown
    )
      return;
    options.toggleWorkspaceSwitcher();
  });
}

function useRecoveryBinding(options: IOptions): void {
  useKeybindingActions('recovery', (actions) => {
    if (
      options.recoveryError !== undefined &&
      !options.recoveryPending &&
      actions.includes('retry')
    ) {
      options.retryRecovery();
    }
  });
}

function useShutdownBindings(options: IOptions): void {
  const { exit } = useApp();
  const requestShutdown = (reason: TSessionEndReason): void => {
    handleInterrupt({
      isShuttingDown: options.isShuttingDown,
      graceful: () => void options.shutdown(reason).finally(() => exit()),
    });
  };
  useInput((input, key) => {
    if (key.ctrl && input === 'c') requestShutdown('prompt_input_exit');
  });
  useEffect(() => {
    const onSignal = (): void => requestShutdown('other');
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    return () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    };
  });
}

export function useAppInputBindings(options: IOptions): boolean {
  useEscapeBindings(options);
  useRecoveryBinding(options);
  useWorkspaceSwitcherBinding(options);
  useShutdownBindings(options);
  const screenReader = useScreenReader();
  useScreenReaderTurnSignals({
    enabled: screenReader,
    isThinking: options.isThinking,
    activeTools: options.activeTools,
    awaitingAnswer: options.permissionRequest !== null || options.pendingUserAction !== null,
  });
  return screenReader;
}
