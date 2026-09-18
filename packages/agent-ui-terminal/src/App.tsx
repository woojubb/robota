import React, { useCallback, useEffect, useRef, useState } from 'react';

import AppView from './AppView.js';
import { useTerminalHandoffSuspension } from './hooks/useTerminalHandoffSuspension.js';
import { TuiCliAdapterProvider } from './tui-cli-adapter-context.js';

import type { ITuiAppChannelPort } from './tui-app-channel-port.js';
import type { ITuiCliAdapter } from './tui-cli-adapter.js';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type { ICommandPluginAdapter } from '@robota-sdk/agent-interface-command';
import type {
  IInteractiveSession,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';

interface IProps {
  cwd: string;
  /** The composition root narrows every concrete channel to this port before React receives it. */
  createChannel: (resumeSessionId?: string) => ITuiAppChannelPort;
  providerOverride?: string | undefined;
  providerType?: string | undefined;
  modelId?: string;
  permissionMode?: TPermissionMode;
  version?: string;
  sessionStore?: IInteractiveSessionStore;
  resumeSessionId?: string;
  showSessionPickerOnStart?: boolean;
  startupUpdateNotice?: Promise<string | undefined>;
  transportRegistry?: ITransportRegistryView<IInteractiveSession>;
  pluginAdapter?: ICommandPluginAdapter;
  cliAdapter: ITuiCliAdapter;
}

interface IActiveChannel {
  readonly state: { channel: ITuiAppChannelPort; sessionId: string | undefined };
  readonly showPicker: boolean;
  readonly error: string | undefined;
  readonly switching: boolean;
  readonly switchSession: (sessionId: string) => Promise<void>;
  readonly retrySwitch: () => void;
}

function useActiveChannel(props: IProps): IActiveChannel {
  const [state, setState] = useState(() => ({
    channel: props.createChannel(props.resumeSessionId),
    sessionId: props.resumeSessionId,
  }));
  const [showPicker, setShowPicker] = useState(props.showSessionPickerOnStart ?? false);
  const [error, setError] = useState<string | undefined>();
  const [isSwitching, setIsSwitching] = useState(false);
  const [failedTarget, setFailedTarget] = useState<string | undefined>();
  const switching = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const switchSession = useCallback(
    async (sessionId: string): Promise<void> => {
      if (switching.current) return;
      switching.current = true;
      setIsSwitching(true);
      try {
        setShowPicker(false);
        await state.channel.stop();
        if (!mounted.current) return;
        setState({ channel: props.createChannel(sessionId), sessionId });
        setFailedTarget(undefined);
        setError(undefined);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(`Session switch failed: ${message}`);
        setFailedTarget(sessionId);
      } finally {
        switching.current = false;
        setIsSwitching(false);
      }
    },
    [props.createChannel, state.channel],
  );
  const retrySwitch = useCallback((): void => {
    if (failedTarget !== undefined) void switchSession(failedTarget);
  }, [failedTarget, switchSession]);
  return { state, showPicker, error, switching: isSwitching, switchSession, retrySwitch };
}

/** React composition shell. Concrete framework objects stay outside the React tree. */
export default function App(props: IProps): React.ReactElement {
  const active = useActiveChannel(props);
  // TERM-002: keep the suspend hook above every input-bearing AppView hook. Returning an empty tree
  // here unmounts all Ink useInput registrations so they can reclaim stdin when the TUI resumes.
  const handoffSuspended = useTerminalHandoffSuspension(
    active.state.channel.terminalHandoffController,
  );

  if (handoffSuspended) return <></>;

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
      />
    </TuiCliAdapterProvider>
  );
}
