import { claimRefusalMessage } from '@robota-sdk/agent-framework';
import { useApp } from 'ink';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import AppView from './AppView.js';
import { TuiCliAdapterProvider } from './tui-cli-adapter-context.js';

import type { IThemeRegistry } from './theme/theme-registry.js';
import type { ITuiAppChannelPort } from './tui-app-channel-port.js';
import type { ITuiCliAdapter } from './tui-cli-adapter.js';
import type { ISessionSwitchOptions } from './types.js';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type { TReducedMotionOverride } from '@robota-sdk/agent-interface-command';
import type { ICommandPluginAdapter } from '@robota-sdk/agent-interface-command';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';
import type { IPromptHistorySource } from '@robota-sdk/agent-interface-session';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';

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
  /** FLOW-2006: a deep link's prefill, consumed once by the composer. */
  initialInput?: string;
  initialInputOrigin?: 'external-link';
  startupUpdateNotice?: Promise<string | undefined>;
  transportRegistry?: ITransportRegistryView;
  pluginAdapter?: ICommandPluginAdapter;
  cliAdapter: ITuiCliAdapter;
  /** SCREEN-1993: the stored-prompt source and project key for the input area's search. */
  promptHistorySource?: IPromptHistorySource;
  promptHistoryProject?: string;
  /** SCREEN-2002: the theme catalogue this run renders from; absent ⇒ the built-ins. */
  themeRegistry?: IThemeRegistry;
  /** SCREEN-2002: reduced motion as the product shell resolved it (settings ← env ← flag). */
  reducedMotion?: boolean | undefined;
  /** SCREEN-2002: which tier decided it, when that was not the settings. */
  reducedMotionOverride?: TReducedMotionOverride | undefined;
}

interface IActiveChannel {
  readonly state: { channel: ITuiAppChannelPort; sessionId: string | undefined };
  readonly showPicker: boolean;
  readonly error: string | undefined;
  readonly switching: boolean;
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

function useActiveChannel(props: IProps, firstChannel: ITuiAppChannelPort): IActiveChannel {
  const [state, setState] = useState(() => ({
    channel: firstChannel,
    sessionId: props.resumeSessionId,
  }));
  const [showPicker, setShowPicker] = useState(props.showSessionPickerOnStart ?? false);
  const [error, setError] = useState<string | undefined>();
  const [isSwitching, setIsSwitching] = useState(false);
  const [failedTarget, setFailedTarget] = useState<IFailedSwitch | undefined>();
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
      try {
        setShowPicker(false);
        if (props.requestSessionSwitch) {
          await props.requestSessionSwitch(sessionId);
        } else {
          await state.channel.stop();
          if (!mounted.current) return;
          setState({
            channel: openChannel(props.createChannel, sessionId, switchOptions?.acceptedDigest),
            sessionId,
          });
        }
        if (!mounted.current) return;
        setFailedTarget(undefined);
        setError(undefined);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(`Session switch failed: ${message}`);
        setFailedTarget({ sessionId, options: switchOptions });
      } finally {
        switching.current = false;
        setIsSwitching(false);
      }
    },
    [props.createChannel, props.requestSessionSwitch, state.channel],
  );
  const retrySwitch = useCallback((): void => {
    if (failedTarget !== undefined)
      void switchSession(failedTarget.sessionId, failedTarget.options);
  }, [failedTarget, switchSession]);
  return { state, showPicker, error, switching: isSwitching, switchSession, retrySwitch };
}

type TFirstChannel = { readonly channel: ITuiAppChannelPort } | { readonly refusal: string };

/**
 * The first channel, or the words of the store's refusal to claim the session the run resumes. That
 * refusal is the one failure of this call that is a message, not a defect: the person is told which
 * process holds the session, and nothing is started over it. Any other failure is Ink's, as before.
 */
function openFirstChannel(props: IProps): TFirstChannel {
  try {
    const channel = openChannel(props.createChannel, props.resumeSessionId, props.acceptedDigest);
    return { channel };
  } catch (error) {
    const refusal = claimRefusalMessage(error);
    if (refusal === undefined) throw error;
    return { refusal };
  }
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
