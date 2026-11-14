import { useState } from 'react';

import { useAppearanceSettings } from './useAppearanceSettings.js';
import { useAppWorkspaceState } from './useAppWorkspaceState.js';
import { useSideEffects } from './useSideEffects.js';
import { useStatusLineSettings } from './useStatusLineSettings.js';

import type { TSessionSwitch } from '../types.js';
import type { IUseSideEffectsResult } from './side-effects-types.js';
import type { IAppWorkspaceState } from './useAppWorkspaceState.js';
import type { ITuiChannelState } from './useTuiChannel.js';
import type {
  IAppearanceSettings,
  IStatusLineCommandSettings,
} from '@robota-sdk/agent-interface/command';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface/session';

interface IOptions {
  readonly state: ITuiChannelState;
  readonly setSessionName: (name: string) => void;
  readonly sessionStore: IInteractiveSessionStore | undefined;
  readonly onSessionSwitch: TSessionSwitch;
  readonly showSessionPickerOnStart: boolean | undefined;
  readonly coordinationBlocked: boolean;
}

export interface IAppScreenState {
  readonly screens: IUseSideEffectsResult;
  readonly workspace: IAppWorkspaceState;
  readonly statusSettings: IStatusLineCommandSettings;
  /** The persisted appearance, re-read after every slash-command result. */
  readonly appearance: IAppearanceSettings;
  /** The input area's history-search overlay is open and owns the keys. */
  readonly historySearchOpen: boolean;
  readonly setHistorySearchOpen: (open: boolean) => void;
}

export function useAppScreenState(options: IOptions): IAppScreenState {
  const [workspaceSwitcherVisible, setWorkspaceSwitcherVisible] = useState(false);
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  const [statusSettings, refreshStatusSettings] = useStatusLineSettings();
  const [appearance, refreshAppearance] = useAppearanceSettings();
  const screens = useSideEffects({
    uiEventPort: options.state.uiEventPort,
    baseHandleSubmit: options.state.handleSubmit,
    setSessionName: options.setSessionName,
    refreshStatusLineSettings: refreshStatusSettings,
    refreshAppearanceSettings: refreshAppearance,
    showSessionPickerOnStart: options.showSessionPickerOnStart,
    openAgentSwitcher: () => setWorkspaceSwitcherVisible(true),
  });
  const navigationEnabled =
    options.state.permissionRequest === null &&
    options.state.pendingUserAction === null &&
    !screens.showPluginTUI &&
    !screens.showTransportTUI &&
    !screens.showSessionPicker &&
    !screens.showThemePicker &&
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
  return {
    screens,
    workspace,
    statusSettings,
    appearance,
    historySearchOpen,
    setHistorySearchOpen,
  };
}
