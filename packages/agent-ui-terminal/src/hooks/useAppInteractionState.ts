import { useAppInputBindings } from './useAppInputBindings.js';
import { useAppOverlays } from './useAppOverlays.js';
import { useAppSubmissionState } from './useAppSubmissionState.js';

import type { IAppOverlays } from './useAppOverlays.js';
import type { IAppScreenState } from './useAppScreenState.js';
import type { IAppSubmissionState } from './useAppSubmissionState.js';
import type { ITuiChannelState } from './useTuiChannel.js';
import type { ICommandPluginAdapter } from '@robota-sdk/agent-interface-command';
import type {
  IInteractiveSession,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';

interface IOptions {
  readonly cwd: string;
  readonly state: ITuiChannelState;
  readonly shell: IAppScreenState;
  readonly sessionStore: IInteractiveSessionStore | undefined;
  readonly onSessionSwitch: (sessionId: string) => Promise<void>;
  readonly pluginAdapter: ICommandPluginAdapter | undefined;
  readonly transportRegistry: ITransportRegistryView<IInteractiveSession> | undefined;
  readonly recoveryError: string | undefined;
  readonly recoveryPending: boolean;
  readonly retryRecovery: () => void;
}

export interface IAppInteractionState {
  readonly submission: IAppSubmissionState;
  readonly overlays: IAppOverlays;
  readonly screenReader: boolean;
}

export function useAppInteractionState(options: IOptions): IAppInteractionState {
  const { screens, workspace } = options.shell;
  const submission = useAppSubmissionState({
    selectedEntry: workspace.background.selectedEntry,
    submit: screens.handleSubmit,
    sendAgentJob: options.state.sendAgentJob,
    isThinking: options.state.isThinking,
  });
  const screenReader = useAppInputBindings({
    isThinking: options.state.isThinking,
    isShuttingDown: options.state.isShuttingDown,
    permissionRequest: options.state.permissionRequest,
    pendingUserAction: options.state.pendingUserAction,
    pluginVisible: screens.showPluginTUI,
    transportVisible: screens.showTransportTUI,
    sessionPickerVisible: screens.showSessionPicker,
    workspaceSwitcherVisible: workspace.background.switcherVisible,
    selectedEntry: workspace.background.selectedEntry,
    mainThreadEntryId: workspace.mainThreadEntryId,
    activeTools: options.state.activeTools,
    abort: options.state.handleAbort,
    toggleWorkspaceSwitcher: workspace.toggleSwitcher,
    selectWorkspaceEntry: options.state.selectExecutionWorkspaceEntry,
    shutdown: options.state.handleShutdown,
    recoveryError: options.recoveryError,
    recoveryPending: options.recoveryPending,
    retryRecovery: options.retryRecovery,
  });
  const overlays = useAppOverlays({
    cwd: options.cwd,
    pluginAdapter: options.pluginAdapter,
    pluginVisible: screens.showPluginTUI,
    setPluginVisible: screens.setShowPluginTUI,
    transportRegistry: options.transportRegistry,
    transportVisible: screens.showTransportTUI,
    setTransportVisible: screens.setShowTransportTUI,
    sessionStore: options.sessionStore,
    sessionPickerVisible: screens.showSessionPicker,
    setSessionPickerVisible: screens.setShowSessionPicker,
    onSessionSwitch: options.onSessionSwitch,
    addEntry: options.state.addEntry,
  });
  return { submission, overlays, screenReader };
}
