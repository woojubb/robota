import { useCallback, useEffect, useState } from 'react';

import { useTerminalTitle } from '../use-terminal-title.js';
import { useTerminalHandoffSuspension } from './useTerminalHandoffSuspension.js';

import type { ITuiAppChannelPort } from '../tui-app-channel-port.js';

export interface IAppLifecycleState {
  readonly sessionName: string | undefined;
  readonly setSessionName: (name: string) => void;
  readonly handoffSuspended: boolean;
  readonly updateNotice: string | undefined;
  readonly startError: string | undefined;
  readonly startPending: boolean;
  readonly retryStart: () => void;
}

function useChannelLifecycle(channel: ITuiAppChannelPort): {
  startError: string | undefined;
  startPending: boolean;
  retryStart: () => void;
} {
  const [startError, setStartError] = useState<string | undefined>();
  const [startPending, setStartPending] = useState(true);
  const retryStart = useCallback((): void => {
    setStartPending(true);
    void channel
      .start()
      .then(() => setStartError(undefined))
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setStartError(`TUI start failed: ${message}`);
      })
      .finally(() => setStartPending(false));
  }, [channel]);
  useEffect(() => {
    retryStart();
  }, [channel, retryStart]);
  return { startError, startPending, retryStart };
}

function useStartupUpdateNotice(source?: Promise<string | undefined>): string | undefined {
  const [notice, setNotice] = useState<string | undefined>();
  useEffect(() => {
    let mounted = true;
    source
      ?.then((value) => {
        if (mounted && value !== undefined) setNotice(value);
      })
      .catch(() => {
        // Startup update checks are best-effort and must not disrupt the TUI.
      });
    return () => {
      mounted = false;
    };
  }, [source]);
  return notice;
}

export function useAppLifecycleState(
  channel: ITuiAppChannelPort,
  startupUpdateNotice?: Promise<string | undefined>,
): IAppLifecycleState {
  const channelLifecycle = useChannelLifecycle(channel);
  const [sessionName, setSessionName] = useState<string | undefined>(channel.sessionName);
  useEffect(() => {
    if (channel.sessionName !== undefined && channel.sessionName !== sessionName) {
      setSessionName(channel.sessionName);
    }
  }, [channel, channel.sessionName, sessionName]);
  useTerminalTitle(sessionName);
  const handoffSuspended = useTerminalHandoffSuspension(channel.terminalHandoffController);
  const updateNotice = useStartupUpdateNotice(startupUpdateNotice);
  return {
    sessionName,
    setSessionName,
    handoffSuspended,
    updateNotice,
    ...channelLifecycle,
  };
}
