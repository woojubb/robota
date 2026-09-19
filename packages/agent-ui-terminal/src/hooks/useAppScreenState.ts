import { useState } from 'react';

import { useAppWorkspaceState } from './useAppWorkspaceState.js';
import { useSideEffects } from './useSideEffects.js';
import { useStatusLineSettings } from './useStatusLineSettings.js';

import type { IUseSideEffectsResult } from './side-effects-types.js';
import type { IAppWorkspaceState } from './useAppWorkspaceState.js';
import type { ITuiChannelState } from './useTuiChannel.js';
import type { IStatusLineCommandSettings } from '@robota-sdk/agent-interface-command';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

interface IOptions {
  readonly state: ITuiChannelState;
  readonly setSessionName: (name: string) => void;
  readonly sessionStore: IInteractiveSessionStore | undefined;
  readonly onSessionSwitch: (sessionId: string) => Promise<void>;
  readonly showSessionPickerOnStart: boolean | undefined;
  readonly coordinationBlocked: boolean;
}

export interface IAppScreenState {
  readonly screens: IUseSideEffectsResult;
  readonly workspace: IAppWorkspaceState;
  readonly statusSettings: IStatusLineCommandSettings;
  /** SCREEN-1993: the input area's history-search overlay is open and owns the keys. */
  readonly historySearchOpen: boolean;
  readonly setHistorySearchOpen: (open: boolean) => void;
}

export function useAppScreenState(options: IOptions): IAppScreenState {
  const [workspaceSwitcherVisible, setWorkspaceSwitcherVisible] = useState(false);
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  const [statusSettings, refreshStatusSettings] = useStatusLineSettings();
  const screens = useSideEffects({
    uiEventPort: options.state.uiEventPort,
    baseHandleSubmit: options.state.handleSubmit,
    setSessionName: options.setSessionName,
    refreshStatusLineSettings: refreshStatusSettings,
    showSessionPickerOnStart: options.showSessionPickerOnStart,
    openAgentSwitcher: () => setWorkspaceSwitcherVisible(true),
  });
  const navigationEnabled =
    options.state.permissionRequest === null &&
    options.state.pendingUserAction === null &&
    !screens.showPluginTUI &&
    !screens.showTransportTUI &&
    !screens.showSessionPicker &&
    !workspaceSwitcherVisible &&
    !historySearchOpen &&
    !options.coordinationBlocked;
  const workspace = useAppWorkspaceState({
    snapshot: options.state.executionWorkspaceSnapshot,
    selectedEntryId: options.state.selectedExecutionEntryId,
    select: options.state.selectExecutionWorkspaceEntry,
    read: options.state.readExecutionWorkspaceDetail,
    sessionStore: options.sessionStore,
    onSessionSwitch: options.onSessionSwitch,
    addEntry: options.state.addEntry,
    navigationEnabled,
    switcherVisible: workspaceSwitcherVisible,
    setSwitcherVisible: setWorkspaceSwitcherVisible,
  });
  return { screens, workspace, statusSettings, historySearchOpen, setHistorySearchOpen };
}
