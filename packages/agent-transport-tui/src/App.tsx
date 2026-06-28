import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { listResumableSessionSummaries } from '@robota-sdk/agent-framework';
import { Box, Static, Text, useApp, useInput } from 'ink';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

import BackgroundTaskPanel from './BackgroundTaskPanel.js';
import { ContextWarningBanner } from './ContextWarningBanner.js';
import {
  countActiveBackgroundWorkspaceEntries,
  getDefaultBackgroundWorkspaceEntries,
} from './execution-workspace-view-model.js';
import ExecutionWorkspaceDetailPane from './ExecutionWorkspaceDetailPane.js';
import ExecutionWorkspaceSwitcher from './ExecutionWorkspaceSwitcher.js';
import { usePluginCallbacks } from './hooks/usePluginCallbacks.js';
import { useSideEffects } from './hooks/useSideEffects.js';
import { useStatusLineSettings } from './hooks/useStatusLineSettings.js';
import { useTerminalHandoffSuspension } from './hooks/useTerminalHandoffSuspension.js';
import { useTuiChannel } from './hooks/useTuiChannel.js';
import InputArea from './InputArea.js';
import InteractivePrompt from './InteractivePrompt.js';
import { EntryItem } from './MessageList.js';
import PendingActionPrompt from './PendingActionPrompt.js';
import PermissionPrompt from './PermissionPrompt.js';
import PluginTUI from './PluginTUI.js';
import SessionPicker from './SessionPicker.js';
import SessionStatusBar from './SessionStatusBar.js';
import StreamingIndicator from './StreamingIndicator.js';
import TransportTUI from './TransportTUI.js';
import { TuiCliAdapterProvider } from './tui-cli-adapter-context.js';
import UpdateNotice from './UpdateNotice.js';

import type { ITuiCliAdapter } from './tui-cli-adapter.js';
import type { TuiInteractionChannel } from './TuiInteractionChannel.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type {
  IExecutionDetailPage,
  IInteractiveSession,
  IInteractiveSessionStore,
  ITransportRegistryView,
} from '@robota-sdk/agent-interface-transport';

/**
 * SCREEN-010: items committed to the terminal scrollback via a single Ink `<Static>` — the startup
 * banner followed by the append-only conversation history. Static renders each item exactly once.
 */
type TStaticItem =
  | { readonly kind: 'banner'; readonly version: string }
  | { readonly kind: 'entry'; readonly entry: IHistoryEntry };

interface IProps {
  cwd: string;
  /**
   * Sole channel source (CLI-B12): App owns the channel lifecycle in React state.
   * The initial channel and every session-switch replacement come from this factory.
   */
  createChannel: (resumeSessionId?: string) => TuiInteractionChannel;
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
  cliAdapter: ITuiCliAdapter;
}

export default function App(props: IProps): React.ReactElement {
  // Lazy initializer: channel construction is side-effect-free (object wiring only);
  // I/O starts in AppInner's effect via channel.start(). Runs once per mount.
  const [sessionState, setSessionState] = useState<{
    channel: TuiInteractionChannel;
    sessionId: string | undefined;
  }>(() => ({
    channel: props.createChannel(props.resumeSessionId),
    sessionId: props.resumeSessionId,
  }));
  const [showInitialSessionPicker, setShowInitialSessionPicker] = useState(
    props.showSessionPickerOnStart ?? false,
  );

  return (
    <TuiCliAdapterProvider value={props.cliAdapter}>
      <AppInner
        key={sessionState.sessionId ?? '__new__'}
        {...props}
        channel={sessionState.channel}
        showSessionPickerOnStart={showInitialSessionPicker}
        resumeSessionId={sessionState.sessionId}
        onSessionSwitch={(sessionId) => {
          setShowInitialSessionPicker(false);
          // Stop the old channel BEFORE the new one becomes active so it can
          // never receive events addressed to the new session (CLI-B12).
          void sessionState.channel.stop();
          setSessionState({ channel: props.createChannel(sessionId), sessionId });
        }}
      />
    </TuiCliAdapterProvider>
  );
}

function AppInner(
  props: IProps & {
    channel: TuiInteractionChannel;
    onSessionSwitch: (sessionId: string) => void;
  },
): React.ReactElement {
  const cwd = props.cwd;
  const { channel } = props;
  // TERM-002: terminal-handoff suspension gate (renders nothing while a child owns the terminal).
  const handoffSuspended = useTerminalHandoffSuspension(channel.terminalHandoffController);

  const {
    interactiveSession,
    registry,
    commandEffectQueue,
    history,
    addEntry,
    streamingText,
    activeTools,
    isThinking,
    isAborting,
    isShuttingDown,
    pendingPrompt,
    executionWorkspaceSnapshot,
    selectedExecutionEntryId,
    selectExecutionWorkspaceEntry,
    readExecutionWorkspaceDetail,
    permissionRequest,
    pendingUserAction,
    contextState,
    handleSubmit: baseHandleSubmit,
    handleAbort,
    handleCancelQueue,
    handleShutdown,
  } = useTuiChannel(channel);

  const [sessionName, setSessionName] = useState<string | undefined>(channel.sessionName);

  const fallbackPluginCallbacks = usePluginCallbacks(cwd);
  const pluginCallbacks = interactiveSession
    ? (undefined as unknown as ReturnType<typeof usePluginCallbacks>)
    : fallbackPluginCallbacks;
  const { exit } = useApp();
  const [updateNotice, setUpdateNotice] = useState<string | undefined>();
  const [showExecutionWorkspaceSwitcher, setShowExecutionWorkspaceSwitcher] = useState(false);
  const [executionDetailPage, setExecutionDetailPage] = useState<IExecutionDetailPage | null>(null);
  const [executionDetailError, setExecutionDetailError] = useState<string | undefined>();
  const [isExecutionDetailLoading, setIsExecutionDetailLoading] = useState(false);
  const [statusLineSettings, setStatusLineSettings] = useStatusLineSettings();
  const [gitRefreshToken, setGitRefreshToken] = useState(0);
  const backgroundWorkspaceEntries = useMemo(
    () => getDefaultBackgroundWorkspaceEntries(executionWorkspaceSnapshot),
    [executionWorkspaceSnapshot],
  );
  const activeBackgroundTaskCount = countActiveBackgroundWorkspaceEntries(
    executionWorkspaceSnapshot,
  );
  const selectedExecutionEntry = useMemo(
    () =>
      executionWorkspaceSnapshot?.entries.find((entry) => entry.id === selectedExecutionEntryId),
    [executionWorkspaceSnapshot, selectedExecutionEntryId],
  );

  const {
    handleSubmit,
    pendingInteractionPrompt,
    showPluginTUI,
    showSessionPicker,
    showTransportTUI,
    setShowPluginTUI,
    setShowSessionPicker,
    setShowTransportTUI,
    handleInteractionSubmit,
    handleInteractionCancel,
  } = useSideEffects({
    cwd,
    providerOverride: props.providerOverride,
    interactiveSession,
    commandEffectQueue,
    addEntry,
    baseHandleSubmit,
    setSessionName,
    setStatusLineSettings,
    showSessionPickerOnStart: props.showSessionPickerOnStart,
    openAgentSwitcher: () => setShowExecutionWorkspaceSwitcher(true),
  });

  useEffect(() => {
    void channel.start();
    return () => {
      void channel.stop();
    };
  }, [channel]);

  const isSelectedEntryInteractive =
    !selectedExecutionEntry ||
    selectedExecutionEntry.kind === 'main_thread' ||
    selectedExecutionEntry.controls.includes('send');

  const activeAgentLabel =
    selectedExecutionEntry && selectedExecutionEntry.kind !== 'main_thread'
      ? selectedExecutionEntry.title
      : undefined;

  const mainThreadEntryId = useMemo(
    () => executionWorkspaceSnapshot?.entries.find((e) => e.kind === 'main_thread')?.id,
    [executionWorkspaceSnapshot],
  );

  const handleSubmitWithRouting = useCallback(
    async (input: string): Promise<void> => {
      if (
        selectedExecutionEntry &&
        selectedExecutionEntry.kind !== 'main_thread' &&
        selectedExecutionEntry.controls.includes('send')
      ) {
        await interactiveSession.sendAgentJob(selectedExecutionEntry.sourceId, input);
      } else {
        await handleSubmit(input);
      }
    },
    [selectedExecutionEntry, handleSubmit, interactiveSession],
  );

  const handleSubmitWithGitRefresh = useCallback(
    async (input: string): Promise<void> => {
      setGitRefreshToken((t) => t + 1);
      await handleSubmitWithRouting(input);
    },
    [handleSubmitWithRouting],
  );

  // Refresh git branch when AI response completes.
  const wasThinkingRef = useRef(false);
  useEffect(() => {
    if (wasThinkingRef.current && !isThinking) {
      setGitRefreshToken((t) => t + 1);
    }
    wasThinkingRef.current = isThinking;
  }, [isThinking]);

  // Sync session name from InteractiveSession when resuming
  useEffect(() => {
    const name = interactiveSession?.getName?.();
    if (name && !sessionName) setSessionName(name);
  }, [interactiveSession, sessionName]);

  useEffect(() => {
    let isMounted = true;
    props.startupUpdateNotice
      ?.then((notice) => {
        if (isMounted && notice !== undefined) {
          setUpdateNotice(notice);
        }
      })
      .catch(() => {
        // Startup update checks are best-effort and must not disrupt the TUI.
      });
    return () => {
      isMounted = false;
    };
  }, [props.startupUpdateNotice]);

  // Update terminal title
  useEffect(() => {
    const title = sessionName ? `Robota — ${sessionName}` : 'Robota';
    process.stdout.write(`\x1b]0;${title}\x07`);
  }, [sessionName]);

  // ESC abort
  useInput((_input: string, key: { escape: boolean }) => {
    if (!key.escape || !isThinking) return;
    if (
      permissionRequest ||
      pendingUserAction ||
      showPluginTUI ||
      showTransportTUI ||
      showSessionPicker ||
      showExecutionWorkspaceSwitcher
    ) {
      return;
    }
    handleAbort();
  });

  // Ctrl+B toggles the execution workspace switcher.
  useInput((input: string, key: { ctrl?: boolean }) => {
    if (!key.ctrl || input !== 'b') return;
    if (
      permissionRequest ||
      pendingUserAction ||
      showPluginTUI ||
      showSessionPicker ||
      isShuttingDown
    )
      return;
    setShowExecutionWorkspaceSwitcher((shown) => !shown);
  });

  // ESC returns to main thread when a background entry is selected (and not thinking).
  useInput((_input: string, key: { escape: boolean }) => {
    if (!key.escape || isThinking) return;
    if (
      permissionRequest ||
      pendingUserAction ||
      showPluginTUI ||
      showTransportTUI ||
      showSessionPicker ||
      showExecutionWorkspaceSwitcher
    ) {
      return;
    }
    if (
      selectedExecutionEntry &&
      selectedExecutionEntry.kind !== 'main_thread' &&
      mainThreadEntryId !== undefined
    ) {
      selectExecutionWorkspaceEntry(mainThreadEntryId);
    }
  });

  // Ctrl+C graceful shutdown
  useInput((input: string, key: { ctrl?: boolean }) => {
    if (!key.ctrl || input !== 'c' || isShuttingDown) return;
    void handleShutdown('prompt_input_exit').finally(() => exit());
  });

  useEffect(() => {
    const onSigterm = (): void => {
      if (isShuttingDown) return;
      void handleShutdown('other').finally(() => exit());
    };
    process.once('SIGINT', onSigterm);
    process.once('SIGTERM', onSigterm);
    return () => {
      process.off('SIGINT', onSigterm);
      process.off('SIGTERM', onSigterm);
    };
  }, [handleShutdown, exit, isShuttingDown]);

  useEffect(() => {
    if (!selectedExecutionEntry || selectedExecutionEntry.kind === 'main_thread') {
      setExecutionDetailPage(null);
      setExecutionDetailError(undefined);
      setIsExecutionDetailLoading(false);
      return;
    }

    let isCurrent = true;
    setIsExecutionDetailLoading(true);
    setExecutionDetailError(undefined);
    readExecutionWorkspaceDetail(selectedExecutionEntry.id)
      .then((page) => {
        if (!isCurrent) return;
        setExecutionDetailPage(page);
        setIsExecutionDetailLoading(false);
      })
      .catch((error: Error) => {
        if (!isCurrent) return;
        setExecutionDetailError(error.message);
        setIsExecutionDetailLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [executionWorkspaceSnapshot, readExecutionWorkspaceDetail, selectedExecutionEntry]);

  // Session may not be initialized yet
  let permissionMode: TPermissionMode = props.permissionMode ?? 'default';
  let sessionId = '';
  let activePresetId: string | undefined;
  try {
    // allow-fallback: session initializes asynchronously; use defaults until ready
    const session = interactiveSession.getSession();
    permissionMode = session.getPermissionMode();
    activePresetId = session.getActivePresetId?.();
    sessionId = session.getSessionId();
  } catch {
    // allow-fallback: session initializes asynchronously; use defaults until ready
    // Not yet initialized
  }

  // SCREEN-010: banner + append-only conversation history are committed to the terminal scrollback
  // via a single Ink <Static> (each item rendered exactly once). The live region below is the only
  // dynamic part. During a terminal handoff (handoffSuspended) the live region is omitted so Ink
  // unmounts its input hooks and releases raw mode (TERM-002) — but <Static> stays mounted at the
  // same tree position, so it does NOT re-print the whole history on resume.
  const staticItems: TStaticItem[] = useMemo(
    () => [
      { kind: 'banner', version: props.version ?? '0.0.0' },
      ...history.map((entry): TStaticItem => ({ kind: 'entry', entry })),
    ],
    [history, props.version],
  );

  return (
    <Box flexDirection="column">
      <Static items={staticItems}>
        {(item) =>
          item.kind === 'banner' ? (
            <Box key="logo" flexDirection="column" paddingX={1} marginBottom={1}>
              <Text color="cyan" bold>{`
  ____   ___  ____   ___ _____  _
 |  _ \\ / _ \\| __ ) / _ \\_   _|/ \\
 | |_) | | | |  _ \\| | | || | / _ \\
 |  _ <| |_| | |_) | |_| || |/ ___ \\
 |_| \\_\\\\___/|____/ \\___/ |_/_/   \\_\\
`}</Text>
              <Text dimColor> v{item.version}</Text>
            </Box>
          ) : (
            <EntryItem key={item.entry.id} entry={item.entry} />
          )
        }
      </Static>
      {!handoffSuspended && (
        <>
          {updateNotice && <UpdateNotice message={updateNotice} />}
          <Box flexDirection="column" paddingX={1} flexGrow={1}>
            {selectedExecutionEntry && selectedExecutionEntry.kind !== 'main_thread' && (
              <ExecutionWorkspaceDetailPane
                entry={selectedExecutionEntry}
                page={executionDetailPage}
                loading={isExecutionDetailLoading}
                error={executionDetailError}
              />
            )}
            {isShuttingDown && (
              <Box marginBottom={1}>
                <Text color="yellow">Shutting down...</Text>
              </Box>
            )}
            {(isThinking || activeTools.length > 0) && (
              <Box flexDirection="column" marginBottom={1}>
                <StreamingIndicator
                  text={streamingText}
                  activeTools={activeTools}
                  isThinking={isThinking}
                />
              </Box>
            )}
            <BackgroundTaskPanel entries={backgroundWorkspaceEntries} />
          </Box>
          {showExecutionWorkspaceSwitcher && (
            <ExecutionWorkspaceSwitcher
              snapshot={executionWorkspaceSnapshot}
              selectedEntryId={selectedExecutionEntryId}
              onSelect={selectExecutionWorkspaceEntry}
              onClose={() => setShowExecutionWorkspaceSwitcher(false)}
            />
          )}
          {permissionRequest && <PermissionPrompt request={permissionRequest} />}
          {pendingInteractionPrompt && (
            <InteractivePrompt
              prompt={pendingInteractionPrompt}
              onSubmit={handleInteractionSubmit}
              onCancel={handleInteractionCancel}
            />
          )}
          {pendingUserAction && (
            <PendingActionPrompt
              request={pendingUserAction}
              onAnswer={(response) => channel.resolveUserAction(response)}
            />
          )}
          {showPluginTUI && (
            <PluginTUI
              callbacks={pluginCallbacks}
              onClose={() => setShowPluginTUI(false)}
              addMessage={(msg) =>
                addEntry(messageToHistoryEntry(createSystemMessage(msg.content)))
              }
            />
          )}
          {showTransportTUI && props.transportRegistry && (
            <TransportTUI
              registry={props.transportRegistry}
              onClose={() => setShowTransportTUI(false)}
            />
          )}
          {showSessionPicker && (
            <SessionPicker
              sessions={listResumableSessionSummaries(props.sessionStore, props.cwd)}
              onSelect={(id) => {
                setShowSessionPicker(false);
                props.onSessionSwitch(id);
              }}
              onCancel={() => {
                setShowSessionPicker(false);
                addEntry(messageToHistoryEntry(createSystemMessage('Session resume cancelled.')));
              }}
            />
          )}
          <ContextWarningBanner percentage={contextState.percentage} />
          <InputArea
            onSubmit={handleSubmitWithGitRefresh}
            onCancelQueue={handleCancelQueue}
            isDisabled={
              !!permissionRequest ||
              !!pendingUserAction ||
              showPluginTUI ||
              showTransportTUI ||
              showSessionPicker ||
              showExecutionWorkspaceSwitcher ||
              isShuttingDown ||
              pendingInteractionPrompt !== null ||
              (isThinking && !!pendingPrompt) ||
              !isSelectedEntryInteractive
            }
            isAborting={isAborting}
            pendingPrompt={pendingPrompt}
            registry={registry}
            sessionName={sessionName}
            history={history}
          />
          <SessionStatusBar
            cwd={cwd}
            permissionMode={permissionMode}
            modelId={props.modelId}
            providerType={props.providerType}
            sessionId={sessionId}
            isThinking={isThinking}
            activeToolCount={activeTools.length}
            activeBackgroundTaskCount={activeBackgroundTaskCount}
            hasPendingPrompt={pendingPrompt !== null}
            contextState={contextState}
            sessionName={sessionName}
            settings={statusLineSettings}
            activeAgentLabel={activeAgentLabel}
            activePresetId={activePresetId}
            gitRefreshToken={gitRefreshToken}
          />
        </>
      )}
    </Box>
  );
}
