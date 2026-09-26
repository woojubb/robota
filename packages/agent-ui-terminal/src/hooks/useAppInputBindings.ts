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
  /** An observer stops nothing: neither the drivers' turn nor their loop. */
  readonly readOnly: boolean;
  /** Attached to a session a host runs: Ctrl-] detaches, like Ctrl-C and `/exit` there. */
  readonly attached: boolean;
  readonly permissionRequest: IPendingPermissionRequest | null;
  readonly pendingUserAction: IActionRequest | null;
  readonly pluginVisible: boolean;
  readonly transportVisible: boolean;
  readonly sessionPickerVisible: boolean;
  readonly workspaceSwitcherVisible: boolean;
  /** SCREEN-1993: the history-search overlay owns Esc and the switcher key while open. */
  readonly historySearchOpen: boolean;
  readonly selectedEntry: IExecutionWorkspaceEntry | undefined;
  readonly backgroundListFocused: boolean;
  readonly mainThreadEntryId: string | undefined;
  readonly activeTools: readonly IToolState[];
  readonly abort: () => void;
  readonly stopWaitingLoop: () => Promise<void>;
  readonly toggleWorkspaceSwitcher: () => void;
  readonly selectWorkspaceEntry: (entryId: string) => void;
  readonly shutdown: (reason?: TSessionEndReason) => Promise<void>;
  readonly recoveryError: string | undefined;
  readonly recoveryPending: boolean;
  readonly coordinationBlocked: boolean;
  /** SCREEN-2002: the theme picker owns its keys while it is open, like every sibling overlay. */
  readonly themePickerVisible: boolean;
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
    options.historySearchOpen ||
    options.themePickerVisible ||
    options.coordinationBlocked,
  );
}

function useEscapeBindings(options: IOptions): void {
  const context = options.isThinking ? 'thinking' : 'background-detail';
  useKeybindingActions(context, (actions) => {
    if (overlaysBlockKeys(options)) return;
    if (actions.includes('abort') && options.isThinking) {
      if (!options.readOnly) options.abort();
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
      return;
    }
    if (
      actions.includes('return-to-main') &&
      !options.backgroundListFocused &&
      !options.readOnly
    ) {
      void options.stopWaitingLoop();
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
      options.historySearchOpen ||
      options.themePickerVisible ||
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

/** Ctrl-]: the raw byte, or `]` with ctrl where the terminal reports modifiers. */
const DETACH_BYTE = '\x1d';

function isDetachKey(input: string, ctrl: boolean): boolean {
  return input === DETACH_BYTE || (ctrl && input === ']');
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
    // Ctrl-] is the attach client's detach key. On a terminal running its own session there is
    // nothing to detach from, and quitting that session is left to Ctrl-C and `/exit`.
    else if (options.attached && isDetachKey(input, key.ctrl)) requestShutdown('prompt_input_exit');
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
