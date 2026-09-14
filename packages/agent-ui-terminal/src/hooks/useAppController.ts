import { useMemo } from 'react';

import { buildStaticItems } from '../app-static-items.js';
import { useAppInteractionState } from './useAppInteractionState.js';
import { useAppLifecycleState } from './useAppLifecycleState.js';
import { useAppScreenState } from './useAppScreenState.js';
import { useTuiChannel } from './useTuiChannel.js';

import type { IAppInputViewModel, IAppStatusViewModel, IAppViewModel } from '../app-view-model.js';
import type { ITuiAppChannelPort, ITuiRuntimeStatusSnapshot } from '../tui-app-channel-port.js';
import type { IAppInteractionState } from './useAppInteractionState.js';
import type { IAppLifecycleState } from './useAppLifecycleState.js';
import type { IAppScreenState } from './useAppScreenState.js';
import type { ITuiChannelState } from './useTuiChannel.js';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type { ICommandPluginAdapter } from '@robota-sdk/agent-interface-command';
import type {
  IInteractiveSession,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';

export interface IUseAppControllerOptions {
  cwd: string;
  providerType?: string | undefined;
  modelId?: string;
  permissionMode?: TPermissionMode;
  version?: string;
  sessionStore?: IInteractiveSessionStore;
  showSessionPickerOnStart?: boolean;
  startupUpdateNotice?: Promise<string | undefined>;
  transportRegistry?: ITransportRegistryView<IInteractiveSession>;
  pluginAdapter?: ICommandPluginAdapter;
  sessionSwitchError?: string;
  sessionSwitchPending?: boolean;
  channel: ITuiAppChannelPort;
  onSessionSwitch: (sessionId: string) => Promise<void>;
  onRetrySessionSwitch: () => void;
}

interface ICoordinationState {
  readonly error: string | undefined;
  readonly pending: boolean;
  readonly blocked: boolean;
}

interface IComposition {
  readonly props: IUseAppControllerOptions;
  readonly state: ITuiChannelState;
  readonly lifecycle: IAppLifecycleState;
  readonly shell: IAppScreenState;
  readonly interaction: IAppInteractionState;
  readonly staticItems: IAppViewModel['staticItems'];
  readonly runtime: ITuiRuntimeStatusSnapshot;
  readonly coordination: ICoordinationState;
}

function getCoordinationState(
  props: IUseAppControllerOptions,
  lifecycle: IAppLifecycleState,
): ICoordinationState {
  const error = props.sessionSwitchError ?? lifecycle.startError;
  const pending = Boolean(props.sessionSwitchPending || lifecycle.startPending);
  return { error, pending, blocked: error !== undefined || pending };
}

function buildInput(composition: IComposition): IAppInputViewModel {
  const { screens, workspace } = composition.shell;
  const state = composition.state;
  const overlayOpen = Boolean(
    state.permissionRequest ||
    state.pendingUserAction ||
    screens.showPluginTUI ||
    screens.showTransportTUI ||
    screens.showSessionPicker ||
    workspace.background.switcherVisible,
  );
  const interactionBlocked =
    composition.coordination.blocked ||
    overlayOpen ||
    state.isShuttingDown ||
    !workspace.isSelectedEntryInteractive ||
    workspace.isBackgroundListFocused;
  return {
    submit: composition.interaction.submission.submit,
    cancelQueue: state.handleCancelQueue,
    disabled: interactionBlocked || (state.isThinking && state.pendingPrompt !== null),
    queueCancellationDisabled: interactionBlocked,
    isAborting: state.isAborting,
    pendingPrompt: state.pendingPrompt,
    pendingCount: state.pendingCount,
    commandQueryPort: state.commandQueryPort,
    sessionName: composition.lifecycle.sessionName,
    history: state.history,
    focusBackgroundList: workspace.focusBackgroundList,
  };
}

function buildStatus(composition: IComposition): IAppStatusViewModel {
  const { props, runtime, state } = composition;
  const workspace = composition.shell.workspace;
  return {
    cwd: props.cwd,
    permissionMode: runtime.permissionMode,
    modelId: props.modelId,
    providerType: props.providerType,
    sessionId: runtime.sessionId,
    isThinking: state.isThinking,
    activeToolCount: state.activeTools.length,
    activeBackgroundTaskCount: workspace.activeBackgroundTaskCount,
    hasPendingPrompt: state.pendingPrompt !== null,
    contextState: state.contextState,
    sessionName: composition.lifecycle.sessionName,
    settings: composition.shell.statusSettings,
    activeAgentLabel: workspace.activeAgentLabel,
    activePresetId: runtime.activePresetId,
    effort: runtime.effort,
    gitRefreshToken: composition.interaction.submission.gitRefreshToken,
  };
}

function buildViewModel(composition: IComposition): IAppViewModel {
  const { interaction, lifecycle, shell, state } = composition;
  return {
    staticItems: composition.staticItems,
    handoffSuspended: lifecycle.handoffSuspended,
    updateNotice: lifecycle.updateNotice,
    coordinationError: composition.coordination.error,
    coordinationPending: composition.coordination.pending,
    sessionEventNotices: state.sessionEventNotices,
    isShuttingDown: state.isShuttingDown,
    stream: {
      text: state.streamingText,
      activeTools: state.activeTools,
      isThinking: state.isThinking,
      isStalled: state.isStalled,
      lastErrorMessage: state.lastErrorMessage,
    },
    background: shell.workspace.background,
    permissionRequest: state.permissionRequest,
    pendingUserAction: state.pendingUserAction,
    resolveUserAction: state.resolveUserAction,
    ...interaction.overlays,
    contextPercentage: state.contextState.percentage,
    input: buildInput(composition),
    status: buildStatus(composition),
  };
}

/** Compose responsibility-specific hooks into the only view model accepted by presentation. */
export function useAppController(props: IUseAppControllerOptions): IAppViewModel {
  const state = useTuiChannel(props.channel);
  const lifecycle = useAppLifecycleState(props.channel, props.startupUpdateNotice);
  const coordination = getCoordinationState(props, lifecycle);
  const shell = useAppScreenState({
    state,
    setSessionName: lifecycle.setSessionName,
    sessionStore: props.sessionStore,
    onSessionSwitch: props.onSessionSwitch,
    showSessionPickerOnStart: props.showSessionPickerOnStart,
    coordinationBlocked: coordination.blocked,
  });
  const interaction = useAppInteractionState({
    cwd: props.cwd,
    state,
    shell,
    sessionStore: props.sessionStore,
    onSessionSwitch: props.onSessionSwitch,
    pluginAdapter: props.pluginAdapter,
    transportRegistry: props.transportRegistry,
    recoveryError: coordination.error,
    recoveryPending: coordination.pending,
    coordinationBlocked: coordination.blocked,
    retryRecovery:
      props.sessionSwitchError !== undefined ? props.onRetrySessionSwitch : lifecycle.retryStart,
  });
  const staticItems = useMemo(
    () =>
      buildStaticItems({
        history: state.history,
        version: props.version,
        screenReader: interaction.screenReader,
      }),
    [interaction.screenReader, props.version, state.history],
  );
  const runtime = state.getRuntimeStatusSnapshot(props.permissionMode ?? 'default');
  return buildViewModel({
    props,
    state,
    lifecycle,
    shell,
    interaction,
    staticItems,
    runtime,
    coordination,
  });
}

export type { IAppViewModel } from '../app-view-model.js';
