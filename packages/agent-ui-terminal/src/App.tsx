import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { claimRefusalMessage } from '@robota-sdk/agent-framework';
import { useApp } from 'ink';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import AppView from './AppView.js';
import {
  JOBS_RUNNING_NOT_SWITCHED_NOTICE,
  liveJobsStoppedBySwitch,
  refusalBeforeStop,
  stopJobsNotice,
} from './flows/session-switch-flow.js';
import { TuiCliAdapterProvider } from './tui-cli-adapter-context.js';

import type { IThemeRegistry } from './theme/theme-registry.js';
import type { ITuiAppChannelPort } from './tui-app-channel-port.js';
import type { ITuiCliAdapter } from './tui-cli-adapter.js';
import type { ISessionSwitchOptions, ISessionSwitchQuestion } from './types.js';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type { TReducedMotionOverride } from '@robota-sdk/agent-interface/command';
import type { ICommandPluginAdapter } from '@robota-sdk/agent-interface/command';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface/session';
import type { IOwnerSessionDirectory } from '@robota-sdk/agent-interface/session';
import type { IPromptHistorySource } from '@robota-sdk/agent-interface/session';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface/transport';

interface IProps {
  cwd: string;
  /** The composition root narrows every concrete channel to this port before React receives it. */
  createChannel: (resumeSessionId?: string, acceptedDigest?: string) => ITuiAppChannelPort;
  /**
   * The session lives on a host this terminal is attached to: a switch is asked of the host, and the
   * channel follows the host's `session_switched`, so the App keeps its channel. Absent ⇒ the App
   * switches by building a channel for the chosen session.
   */
  requestSessionSwitch?: (sessionId: string) => Promise<void>;
  ownerSessions?: IOwnerSessionDirectory;
  onOwnerInvalidated?: (listener: () => void) => () => void;
  providerOverride?: string | undefined;
  providerType?: string | undefined;
  modelId?: string;
  permissionMode?: TPermissionMode;
  version?: string;
  sessionStore?: IInteractiveSessionStore;
  resumeSessionId?: string;
  /**
   * The SHA-256 of the stored record bytes the person accepted as theirs for `resumeSessionId`, when
   * the first channel resumes a record the store could not show to be theirs. Handed to that channel
   * only; a later switch carries its own.
   */
  acceptedDigest?: string;
  showSessionPickerOnStart?: boolean;
  /** A deep link's prefill, consumed once by the composer. */
  initialInput?: string;
  initialInputOrigin?: 'external-link';
  startupUpdateNotice?: Promise<string | undefined>;
  transportRegistry?: ITransportRegistryView;
  pluginAdapter?: ICommandPluginAdapter;
  cliAdapter: ITuiCliAdapter;
  /** The stored-prompt source and project key for the input area's search. */
  promptHistorySource?: IPromptHistorySource;
  promptHistoryProject?: string;
  /** The theme catalogue this run renders from; absent ⇒ the built-ins. */
  themeRegistry?: IThemeRegistry;
  /** Reduced motion as the product shell resolved it (settings ← env ← flag). */
  reducedMotion?: boolean | undefined;
  /** Which tier decided it, when that was not the settings. */
  reducedMotionOverride?: TReducedMotionOverride | undefined;
}

interface IActiveChannel {
  readonly state: {
    channel: ITuiAppChannelPort;
    sessionId: string | undefined;
    /** Words the store gave for a switch that went back to this session, written once it has started. */
    notice?: string;
  };
  readonly showPicker: boolean;
  readonly error: string | undefined;
  readonly switching: boolean;
  /** Open while the person is asked whether to stop the running jobs a switch would cancel. */
  readonly question: ISessionSwitchQuestion | undefined;
  readonly switchSession: (sessionId: string, options?: ISessionSwitchOptions) => Promise<void>;
  readonly retrySwitch: () => void;
}

/** The channel for `sessionId`; the call names a digest only when the person accepted one. */
function openChannel(
  createChannel: IProps['createChannel'],
  sessionId: string | undefined,
  acceptedDigest: string | undefined,
): ITuiAppChannelPort {
  return acceptedDigest === undefined
    ? createChannel(sessionId)
    : createChannel(sessionId, acceptedDigest);
}

interface IFailedSwitch {
  readonly sessionId: string;
  readonly options: ISessionSwitchOptions | undefined;
}

/** The channel for `sessionId`, or the words of the store's refusal to claim it; any other failure is the caller's. */
function openOrRefusal(
  createChannel: IProps['createChannel'],
  sessionId: string | undefined,
  acceptedDigest: string | undefined,
): TFirstChannel {
  try {
    return { channel: openChannel(createChannel, sessionId, acceptedDigest) };
  } catch (error) {
    const refusal = claimRefusalMessage(error);
    if (refusal === undefined) throw error;
    return { refusal };
  }
}

const systemEntry = (text: string) => messageToHistoryEntry(createSystemMessage(text));

function useActiveChannel(props: IProps, firstChannel: ITuiAppChannelPort): IActiveChannel {
  const [state, setState] = useState<IActiveChannel['state']>(() => ({
    channel: firstChannel,
    sessionId: props.resumeSessionId,
  }));
  const [showPicker, setShowPicker] = useState(props.showSessionPickerOnStart ?? false);
  const [error, setError] = useState<string | undefined>();
  const [isSwitching, setIsSwitching] = useState(false);
  const [failedTarget, setFailedTarget] = useState<IFailedSwitch | undefined>();
  const [question, setQuestion] = useState<ISessionSwitchQuestion | undefined>();
  const switching = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const switchSession = useCallback(
    async (sessionId: string, switchOptions?: ISessionSwitchOptions): Promise<void> => {
      if (switching.current) return;
      switching.current = true;
      setIsSwitching(true);
      let retry: IFailedSwitch = { sessionId, options: switchOptions };
      try {
        setShowPicker(false);
        if (props.requestSessionSwitch) {
          await props.requestSessionSwitch(sessionId);
        } else {
          const here = state.channel.getRuntimeStatusSnapshot(props.permissionMode ?? 'default');
          const refusal = refusalBeforeStop(props.sessionStore, sessionId, here.sessionId);
          if (refusal !== undefined) {
            // A held id stops nothing: the person stays on the session they are on, told by the store.
            state.channel.addEntry(systemEntry(refusal));
          } else {
            // Stopping the channel cancels the jobs its session runs, so that is the person's call.
            const live = liveJobsStoppedBySwitch(
              state.channel.getSnapshot().executionWorkspaceSnapshot,
            );
            if (live > (switchOptions?.liveJobsApproved ?? 0)) {
              const channel = state.channel;
              // The failure a retry was offered for gives way to the question: both want the keys.
              setFailedTarget(undefined);
              setError(undefined);
              setQuestion({
                message: `${stopJobsNotice(live)} Switch sessions?`,
                answer: (yes) => {
                  setQuestion(undefined);
                  if (!yes) {
                    channel.addEntry(systemEntry(JOBS_RUNNING_NOT_SWITCHED_NOTICE));
                    return;
                  }
                  void switchSession(sessionId, { ...switchOptions, liveJobsApproved: live });
                },
              });
              return;
            }
            // A retry after a failed stop must not ask again about jobs the person already agreed to.
            retry = { sessionId, options: { ...switchOptions, liveJobsApproved: live } };
            await state.channel.stop();
            if (!mounted.current) return;
            const opened = openOrRefusal(
              props.createChannel,
              sessionId,
              switchOptions?.acceptedDigest,
            );
            if ('channel' in opened) {
              setState({ channel: opened.channel, sessionId });
            } else {
              // A writer took the id after it was asked about. The person is back on the session
              // they were on, with the store's words, and the refused id is not tried again.
              const previous = here.sessionId === '' ? undefined : here.sessionId;
              if (previous !== undefined) {
                retry = { sessionId: previous, options: { liveJobsApproved: live } };
              }
              setState({
                channel: openChannel(props.createChannel, previous, undefined),
                sessionId: previous,
                notice: opened.refusal,
              });
            }
          }
        }
        if (!mounted.current) return;
        setFailedTarget(undefined);
        setError(undefined);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(`Session switch failed: ${message}`);
        setFailedTarget(retry);
      } finally {
        switching.current = false;
        setIsSwitching(false);
      }
    },
    [
      props.createChannel,
      props.requestSessionSwitch,
      props.sessionStore,
      props.permissionMode,
      state.channel,
    ],
  );
  const retrySwitch = useCallback((): void => {
    if (failedTarget !== undefined)
      void switchSession(failedTarget.sessionId, failedTarget.options);
  }, [failedTarget, switchSession]);
  return { state, showPicker, error, switching: isSwitching, question, switchSession, retrySwitch };
}

type TFirstChannel = { readonly channel: ITuiAppChannelPort } | { readonly refusal: string };

/**
 * The first channel, or the words of the store's refusal to claim the session the run resumes. That
 * refusal is the one failure of this call that is a message, not a defect: the person is told which
 * process holds the session, and nothing is started over it. Any other failure is Ink's, as before.
 */
function openFirstChannel(props: IProps): TFirstChannel {
  return openOrRefusal(props.createChannel, props.resumeSessionId, props.acceptedDigest);
}

/** Ends the run with the refusal's words as its error; the run's entry says them, once, and exits. */
function EndOnRefusal(props: { readonly message: string }): null {
  const { exit } = useApp();
  useEffect(() => {
    exit(new Error(props.message));
  }, [exit, props.message]);
  return null;
}

/** React composition shell. Concrete framework objects stay outside the React tree. */
export default function App(props: IProps): React.ReactElement {
  const [first] = useState(() => openFirstChannel(props));
  return 'refusal' in first ? (
    <EndOnRefusal message={first.refusal} />
  ) : (
    <ActiveApp {...props} firstChannel={first.channel} />
  );
}

function ActiveApp(
  props: IProps & { readonly firstChannel: ITuiAppChannelPort },
): React.ReactElement {
  const active = useActiveChannel(props, props.firstChannel);
  const { channel, notice } = active.state;
  // A child's effects run first, so the channel has started, and restored its transcript, by now.
  useEffect(() => {
    if (notice !== undefined) channel.addEntry(systemEntry(notice));
  }, [channel, notice]);

  return (
    <TuiCliAdapterProvider value={props.cliAdapter}>
      <AppView
        key={active.state.sessionId ?? '__new__'}
        cwd={props.cwd}
        channel={active.state.channel}
        onSessionSwitch={active.switchSession}
        onRetrySessionSwitch={active.retrySwitch}
        sessionSwitchError={active.error}
        sessionSwitchPending={active.switching}
        sessionSwitchQuestion={active.question}
        showSessionPickerOnStart={active.showPicker}
        {...(props.initialInput !== undefined ? { initialInput: props.initialInput } : {})}
        {...(props.initialInputOrigin !== undefined
          ? { initialInputOrigin: props.initialInputOrigin }
          : {})}
        {...(props.providerType !== undefined ? { providerType: props.providerType } : {})}
        {...(props.modelId !== undefined ? { modelId: props.modelId } : {})}
        {...(props.permissionMode !== undefined ? { permissionMode: props.permissionMode } : {})}
        {...(props.version !== undefined ? { version: props.version } : {})}
        {...(props.sessionStore !== undefined ? { sessionStore: props.sessionStore } : {})}
        {...(props.ownerSessions !== undefined ? { ownerSessions: props.ownerSessions } : {})}
        {...(props.onOwnerInvalidated !== undefined ? { onOwnerInvalidated: props.onOwnerInvalidated } : {})}
        {...(props.startupUpdateNotice !== undefined
          ? { startupUpdateNotice: props.startupUpdateNotice }
          : {})}
        {...(props.transportRegistry !== undefined
          ? { transportRegistry: props.transportRegistry }
          : {})}
        {...(props.pluginAdapter !== undefined ? { pluginAdapter: props.pluginAdapter } : {})}
        {...(props.promptHistorySource !== undefined
          ? { promptHistorySource: props.promptHistorySource }
          : {})}
        {...(props.promptHistoryProject !== undefined
          ? { promptHistoryProject: props.promptHistoryProject }
          : {})}
        {...(props.themeRegistry !== undefined ? { themeRegistry: props.themeRegistry } : {})}
        {...(props.reducedMotion !== undefined ? { reducedMotion: props.reducedMotion } : {})}
        {...(props.reducedMotionOverride !== undefined
          ? { reducedMotionOverride: props.reducedMotionOverride }
          : {})}
      />
    </TuiCliAdapterProvider>
  );
}
