import { useCallback, useMemo, useState } from 'react';

import { buildStaticItems } from '../app-static-items.js';
import { useAppInteractionState } from './useAppInteractionState.js';
import { useAppLifecycleState } from './useAppLifecycleState.js';
import { useAppScreenState } from './useAppScreenState.js';
import { useAppThemeState } from './useAppThemeState.js';
import { useTuiChannel } from './useTuiChannel.js';

import type { IBuildStaticItemsInputs } from '../app-static-items.js';
import type { IAppInputViewModel, IAppStatusViewModel, IAppViewModel } from '../app-view-model.js';
import type { ITuiAppChannelPort, ITuiRuntimeStatusSnapshot } from '../tui-app-channel-port.js';
import type { IAppInteractionState } from './useAppInteractionState.js';
import type { IAppLifecycleState } from './useAppLifecycleState.js';
import type { IAppScreenState } from './useAppScreenState.js';
import type { IAppThemeViewModel } from './useAppThemeState.js';
import type { ITuiChannelState } from './useTuiChannel.js';
import type { IThemeRegistry } from '../theme/theme-registry.js';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type { TReducedMotionOverride } from '@robota-sdk/agent-interface-command';
import type { ICommandPluginAdapter } from '@robota-sdk/agent-interface-command';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';
import type { IPromptHistorySource } from '@robota-sdk/agent-interface-session';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';

export interface IUseAppControllerOptions {
  cwd: string;
  providerType?: string | undefined;
  modelId?: string;
  permissionMode?: TPermissionMode;
  version?: string;
  sessionStore?: IInteractiveSessionStore;
  showSessionPickerOnStart?: boolean;
  /** FLOW-2006: a deep link's prefill, handed to the composer exactly once. */
  initialInput?: string;
  initialInputOrigin?: 'external-link';
  startupUpdateNotice?: Promise<string | undefined>;
  transportRegistry?: ITransportRegistryView;
  pluginAdapter?: ICommandPluginAdapter;
  sessionSwitchError?: string;
  sessionSwitchPending?: boolean;
  channel: ITuiAppChannelPort;
  onSessionSwitch: (sessionId: string) => Promise<void>;
  onRetrySessionSwitch: () => void;
  /** SCREEN-1993: the stored-prompt source and this run's project key; both or neither. */
  promptHistorySource?: IPromptHistorySource;
  promptHistoryProject?: string;
  /** SCREEN-2002: the catalogue this surface renders from; absent ⇒ the built-ins. */
  themeRegistry?: IThemeRegistry;
  /** SCREEN-2002: reduced motion as the product shell resolved it (settings ← env ← flag). */
  reducedMotion?: boolean | undefined;
  /** SCREEN-2002: which tier decided it, when that was not the settings. */
  reducedMotionOverride?: TReducedMotionOverride | undefined;
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
  readonly theme: IAppThemeViewModel;
}

function getCoordinationState(
  props: IUseAppControllerOptions,
  lifecycle: IAppLifecycleState,
): ICoordinationState {
  const error = props.sessionSwitchError ?? lifecycle.startError;
  const pending = Boolean(props.sessionSwitchPending || lifecycle.startPending);
  return { error, pending, blocked: error !== undefined || pending };
}

function buildHistorySearch(composition: IComposition): IAppInputViewModel['historySearch'] {
  const { promptHistorySource, promptHistoryProject } = composition.props;
  if (promptHistorySource === undefined || promptHistoryProject === undefined) return undefined;
  return {
    source: promptHistorySource,
    project: promptHistoryProject,
    sessionId: composition.runtime.sessionId,
    onOpenChange: composition.shell.setHistorySearchOpen,
  };
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
    screens.showThemePicker ||
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
    historySearch: buildHistorySearch(composition),
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
    theme: composition.theme,
    contextPercentage: state.contextState.percentage,
    input: buildInput(composition),
    status: buildStatus(composition),
  };
}

/** The live theme and its picker, composed from the shell's persisted appearance and the shell's props. */
function useControllerTheme(
  props: IUseAppControllerOptions,
  shell: IAppScreenState,
): IAppThemeViewModel {
  return useAppThemeState({
    appearance: shell.appearance,
    registry: props.themeRegistry,
    reducedMotion: props.reducedMotion,
    reducedMotionOverride: props.reducedMotionOverride,
    visible: shell.screens.showThemePicker,
    setVisible: shell.screens.setShowThemePicker,
    submit: (input) => void shell.screens.handleSubmit(input),
  });
}

/**
 * FLOW-2006: the deep link's prefill is owned HERE, not by the composer's `useState` initializer.
 * `AppPresentation` unmounts the prompt subtree while a terminal handoff is suspended, so a
 * component-local initializer would re-seed a prompt the user had already cleared or submitted.
 */
function useExternalPrefill(
  initialInput: string | undefined,
  origin: IUseAppControllerOptions['initialInputOrigin'],
): Pick<IAppInputViewModel, 'initialValue' | 'consumeInitialValue' | 'externalPromptOrigin'> {
  const [initialValue, setInitialValue] = useState(initialInput);
  const consumeInitialValue = useCallback(() => setInitialValue(undefined), []);
  return { initialValue, consumeInitialValue, externalPromptOrigin: origin === 'external-link' };
}

/** The scrollback Ink commits once: the banner (unless suppressed) and the settled history. */
function useStaticItems(
  history: IBuildStaticItemsInputs['history'],
  version: IBuildStaticItemsInputs['version'],
  screenReader: IBuildStaticItemsInputs['screenReader'],
): IAppViewModel['staticItems'] {
  return useMemo(
    () => buildStaticItems({ history, version, screenReader }),
    [history, screenReader, version],
  );
}

/** Compose responsibility-specific hooks into the only view model accepted by presentation. */
export function useAppController(props: IUseAppControllerOptions): IAppViewModel {
  const prefill = useExternalPrefill(props.initialInput, props.initialInputOrigin);
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
  const staticItems = useStaticItems(state.history, props.version, interaction.screenReader);
  const runtime = state.getRuntimeStatusSnapshot(props.permissionMode ?? 'default');
  const theme = useControllerTheme(props, shell);
  const viewModel = buildViewModel({
    props,
    state,
    lifecycle,
    shell,
    interaction,
    staticItems,
    runtime,
    coordination,
    theme,
  });
  return { ...viewModel, input: { ...viewModel.input, ...prefill } };
}

export type { IAppViewModel } from '../app-view-model.js';
